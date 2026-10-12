// Tool-boundary seam tests for push_ui (issue #39, spec #37 seam 1):
// full push, replace semantics, validation errors, caps, response shape.
// Pattern: lib/mcpSurface.test.ts (real store in a tmp dir + MCP client).
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "../server";

// The sandbox only allows fixed localhost ports in 3000-3999 / 5000-5999 / 7634.
const PORT = 5077;
const BASE = `http://127.0.0.1:${PORT}`;

delete process.env.OPENROUTER_API_KEY;

let root: string;
let artifactsDir: string;
let server: ReturnType<typeof createServer>;

function makeClient() {
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`));
  const client = new Client({ name: "test-client", version: "0.0.1" });
  return { client, transport };
}

const VALID_PROGRAM = `root = Stack([card1], "column")
card1 = Card([t1])
t1 = Text("hello aurora")`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "aurora-push-ui-root-"));
  artifactsDir = mkdtempSync(join(tmpdir(), "aurora-push-ui-artifacts-"));
  server = createServer(root, PORT, { artifactsDir });
});

afterAll(() => {
  server?.stop(true);
  rmSync(root, { recursive: true, force: true });
  rmSync(artifactsDir, { recursive: true, force: true });
});

async function pushUi(args: Record<string, unknown>) {
  const { client, transport } = makeClient();
  await client.connect(transport);
  const res = await client.callTool({ name: "push_ui", arguments: args });
  await client.close();
  return res;
}

describe("push_ui", () => {
  it("is registered with a generated description carrying cross-guidance", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "push_ui");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("push_chart");
    expect(tool!.description).toContain("Stack");
    await client.close();
  });

  it("push_chart's description carries the cross-guidance line", async () => {
    const { client, transport } = makeClient();
    await client.connect(transport);
    const { tools } = await client.listTools();
    const chart = tools.find((t) => t.name === "push_chart");
    expect(chart!.description).toContain("push_ui");
    await client.close();
  });

  it("full push: validates, snapshots as type ui, echoes artifact id / created / deep link", async () => {
    const res = await pushUi({
      session_id: "ui-agent",
      title: "Quarterly dashboard",
      program: VALID_PROGRAM,
      session_title: "Dashboards",
    });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as any;
    expect(sc.created).toBe(true);
    expect(sc.artifact_id).toMatch(/^[\w.-]+$/);
    expect(sc.deep_link).toBe(`${BASE}/preview/ui-agent`);
    // The program source itself is stored (ADR 0002), as a ui-type artifact.
    const fetched = await (
      await fetch(`${BASE}/api/preview/sessions/ui-agent/artifacts/${sc.artifact_id}`)
    ).json();
    expect(fetched.meta.type).toBe("ui");
    expect(fetched.content).toContain('t1 = Text("hello aurora")');
  });

  it("replace semantics: same artifact_id replaces in place (created=false)", async () => {
    const first = await pushUi({
      session_id: "ui-replace",
      title: "v1",
      program: VALID_PROGRAM,
    });
    const aid = (first.structuredContent as any).artifact_id;
    const second = await pushUi({
      session_id: "ui-replace",
      title: "v2",
      program: VALID_PROGRAM,
      artifact_id: aid,
    });
    expect((second.structuredContent as any).created).toBe(false);
    expect((second.structuredContent as any).artifact_id).toBe(aid);
  });

  it("invalid program: isError with every invalid statement surfaced", async () => {
    const res = await pushUi({
      session_id: "ui-bad",
      title: "Broken",
      program: `root = Stack([bogus], "column")\nbogus = Bogus("nope")`,
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any)[0].text;
    expect(text).toContain("bogus");
    expect(text).toContain("unknown-component");
    // nothing stored on a rejected push
    // no session was created either (implicit-create happens only on a valid push)
    const listed = await (await fetch(`${BASE}/api/preview/sessions/ui-bad/artifacts`)).json();
    expect(listed.error ?? listed).toBeDefined();
    expect(Array.isArray(listed) ? listed.length : 0).toBe(0);
  });

  it("composed dashboard with chart, diagram, and text pushes as one artifact (issue #40)", async () => {
    const program = [
      'root = Stack([t1, c1, m1], "column")',
      't1 = Text("Quarterly revenue")',
      'c1 = Chart("pie", {kind: "pie", points: [{label: "Q1", value: 12}, {label: "Q2", value: 9}]})',
      'm1 = Mermaid("flowchart TD\\n  A-->B")',
    ].join("\n");
    const res = await pushUi({ session_id: "ui-compose", title: "Composed dashboard", program });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as any;
    const fetched = await (
      await fetch(`${BASE}/api/preview/sessions/ui-compose/artifacts/${sc.artifact_id}`)
    ).json();
    expect(fetched.meta.type).toBe("ui");
    expect(fetched.content).toContain("Chart(\"pie\"");
    expect(fetched.content).toContain("Mermaid(");
  });

  it("chart kind mismatch inside a program is rejected with the single-chart tool's exact error", async () => {
    const program = [
      'root = Stack([c1], "column")',
      'c1 = Chart("bar", {kind: "pie", points: [{label: "A", value: 1}]})',
    ].join("\n");
    const res = await pushUi({ session_id: "ui-chart-bad", title: "Bad chart", program });
    expect(res.isError).toBe(true);
    // Verbatim chartContractError message, identical to push_chart's rejection.
    expect((res.content as any)[0].text).toContain(
      'chart_type "bar" requires data of kind "categorical" (got "pie")'
    );
  });

  it("statement cap rejection surfaces an actionable error", async () => {
    const program = [`root = Stack([c0], "column")`, `c0 = Card([t0])`]
      .concat(Array.from({ length: 200 }, (_, i) => `t${i} = Text("x")`))
      .join("\n");
    const res = await pushUi({ session_id: "ui-cap", title: "Too big", program });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toContain("200-statement cap");
  });

  it("string cap rejection surfaces line and cap in the error", async () => {
    const big = "y".repeat(10_001);
    const res = await pushUi({
      session_id: "ui-strcap",
      title: "Too long",
      program: `root = Stack([t], "column")\nt = Text("${big}")`,
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any)[0].text;
    expect(text).toContain("10,000");
    expect(text).toContain("line 2");
  });
});
