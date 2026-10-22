// CLI argument contract: `bun cli.ts [--port N]` — no positional args.
// Only the rejection paths are spawned; a valid invocation boots the server
// and would need a fixed sandbox port plus a temp artifact store (covered by
// server.test.ts route tests instead).

import { describe, it, expect } from "bun:test";

const CLI = new URL("./cli.ts", import.meta.url).pathname;
const USAGE = "Usage: aurora [--port <port>]";

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as any).text(),
    new Response(proc.stderr as any).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("cli args", () => {
  it.each([
    ["a positional rootDir", ["./some/project"], "Unexpected argument: ./some/project"],
    ["an unknown flag", ["--bogus"], "Unexpected argument: --bogus"],
    ["--port with no value", ["--port"], USAGE],
  ])("rejects %s loudly with usage text", async (_label, args, expected) => {
    const { exitCode, stderr } = await runCli(args);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain(expected);
    expect(stderr).toContain(USAGE);
  });
});
