# Research: OpenUI / OpenUI Lang

Research date: 2026-10-12. Web evidence was fetched live from openui.com on this date (supervisor-fetched page extracts, cross-checked against GitHub/npm APIs). Aurora-side claims are grounded in local reads of this worktree (README.md, CONTEXT.md, ADR 0002, ADR 0003, `lib/mcpSurface.ts`, `lib/chartContract.ts`).

Labels used throughout: **[direct]** = stated by the cited source; **[interpretation]** = reading meaning from source content; **[inference]** = researcher reasoning, not stated by any source.

---

## 1. What OpenUI / OpenUI Lang is

**Maintainer and purpose.** OpenUI Lang is "an open, compact language for describing interfaces with components your application controls" — models generate it, renderers display it progressively, and applications use it with any model provider, agent framework, or chat library. [direct, https://www.openui.com/docs/openui-lang]

The maintainer is **Thesys** (GitHub org `thesysdev`), which describes the repo as "The Open Standard for Generative UI" with homepage openui.com. [direct, https://api.github.com/repos/thesysdev/openui] The docs' positioning is that OpenUI Lang is "the contract between a model and your application": you define the components the model may use, generate instructions from those definitions, and stream the model's response into a renderer. [direct, https://www.openui.com/docs/openui-lang/overview]

It was created to fix three problems with JSON-based generative UI (the docs name Vercel JSON-Render and A2UI as existing JSON implementations): token verbosity, poor streaming behavior, and robustness (hallucinated components / invalid structures). [direct, https://www.openui.com/docs/openui-lang]

## 2. How it works

### 2.1 The four pieces

Four components make the flow work: (1) a **component library** — your Zod schemas and framework components define what the model can use; (2) a **system prompt** generated from that library; (3) a streaming **parser** that turns OpenUI Lang into a typed element tree, validating component usage and handling partial output; (4) a **renderer** that maps the parsed tree to your components. [direct, https://www.openui.com/docs/openui-lang/overview]

"The language and renderer do not depend on a model provider, chat library, or hosted service." [direct, https://www.openui.com/docs/openui-lang/overview]

### 2.2 The language (spec v0.5)

OpenUI Lang is line-oriented: one assignment statement per line, `identifier = Expression`. Three statement types: component calls (`header = CardHeader("Title")`), state declarations (`$days = "7"`), and data statements (`data = Query("tool", {}, {rows: []})`). [direct, https://www.openui.com/docs/openui-lang/specification-v05]

Core rules from the v0.5 spec [direct, https://www.openui.com/docs/openui-lang/specification-v05]:
- `root = Root([children])` is the required entry point; if missing, nothing renders.
- **Top-down generation** (layout → components → data) enables progressive streaming.
- **Positional arguments** mapped to props by Zod schema key order — "Positional only: Write `Stack([children], "row", "l")` NOT `Stack([children], direction: "row", gap: "l")`".
- **Forward references allowed**: `root = Stack([chart])` may appear before `chart = ...` is defined.
- Built-in functions use the `@` prefix (`@Count`, `@Filter`, `@Sort`, `@Each`, …); bare names are not supported.
- Expressions include strings, numbers, booleans, null, arrays, objects, references, `$state` refs, member access with array "column pluck" (`data.rows.title`), ternaries, and binary ops.

A real example program (the docs' sign-up form) [direct, https://www.openui.com/docs/openui-lang/overview]:

```
root = Stack([welcomeCard])
welcomeCard = MyCard([welcomeHeader, welcomeBody])
welcomeHeader = CardHeader("Welcome", "Get started with our platform")
welcomeBody = Stack([signupForm], "column", "m")
signupForm = Form("signup", [nameField, emailField], actions)
nameField = FormControl("Name", Input("name", "Your name", "text", ["required", "minLength:2"]))
emailField = FormControl("Email", Input("email", "you@example.com", "email", ["required", "email"]))
actions = Buttons([signUpBtn, learnMoreBtn], "row")
signUpBtn = Button("Sign up", "submit:signup", "primary")
learnMoreBtn = Button("Learn more", "action:learn_more", "secondary")
```

### 2.3 How applications define their own component library

Applications register components with `defineComponent({ name, description, props: z.object(...), component })` and assemble them with `createLibrary({ root, components, componentGroups })`. The `root` field constrains the LLM to a known top-level component (making output predictable and letting the UI shell render immediately); props map positionally by **Zod object key order**; composition uses `z.array(ChildComponent.ref)` so each child is a separate line that streams and validates independently; `componentGroups` with `notes` organize the generated prompt. [direct, https://www.openui.com/docs/openui-lang/defining-components]

Best practices the docs emphasize: keep schemas flat, order Zod keys deliberately (required first, most distinctive prop position 0), descriptive component names, limit library size, use `.ref` for composition, provide examples in `PromptOptions`. [direct, https://www.openui.com/docs/openui-lang/defining-components]

The system prompt is generated at build time by `@openuidev/cli generate --spec` (emits a serialized library spec) and at runtime by `generateSystemPrompt()` from `@openuidev/lang-core` — which "has no React dependency, so it works in any Node, Edge, or serverless backend". Feature flags control what the prompt teaches the model: `toolCalls` (Query/Mutation/@Run; default true if tools provided), `bindings` ($variables/@Set/@Reset; default true if toolCalls), `editMode` (incremental patches; default false), `inlineMode` (text + fenced code; default false). [direct, https://www.openui.com/docs/openui-lang/system-prompts and /specification-v05]

### 2.4 The streaming renderer

`<Renderer library={...} response={content} isStreaming={...} />` maps parsed statements to your React components. Its props include `onAction` (structured action events), `onStateUpdate`/`initialState` (form state persistence), `toolProvider` (a function map **or an MCP client** handling `Query()`/`Mutation()` calls), and `onError` (structured, LLM-friendly errors "suitable for automated correction loops"). [direct, https://www.openui.com/docs/openui-lang/renderer]

Streaming behavior [direct, https://www.openui.com/docs/openui-lang/renderer]:
- The parser re-runs as chunks arrive; forward references resolve when their statements arrive.
- Unresolved references and invalid components are **dropped from arrays**, not left as null holes.
- `meta.orphaned` lists defined-but-unreachable statements on every chunk.
- Error codes include `unknown-component`, `missing-required`, `excess-args` (extras dropped, still renders), `parse-failed`, `runtime-error`, `render-error` — with `onError` designed so errors can be "send[...] back to LLM for self-correction".

Robustness posture from the intro: "OpenUI Lang validates output and drops invalid portions, rendering only what's valid." [direct, https://www.openui.com/docs/openui-lang]

### 2.5 Interactivity and the generate/execute split

Beyond static UI, v0.5 adds reactive state and data wiring: `$variables` create two-way bindings; `Query("tool", args, defaults, refreshSeconds?)` executes against the app's tools (function map or MCP client) with reactive re-fetch when `$variables` in args change; `Mutation` runs only when triggered via `Action([...@Run(ref), @Set(...), @Reset(...)])`. The stated architecture goal: **separate generation from execution** — "The LLM generated the wiring. The runtime executes it." — so clicks, filters, and refreshes cost zero LLM tokens. [direct, https://www.openui.com/docs/openui-lang/architecture, /reactive-state, /queries-mutations, /interactivity]

**Incremental editing** (with `editMode: true`): the LLM outputs only changed/new statements and the parser merges by statement name — same name replaces, new name added, missing kept, explicit removal from `root` garbage-collects. Docs claim a 2-statement ~60-token patch vs ~400-token full regeneration, "up to 85% fewer tokens". [direct, https://www.openui.com/docs/openui-lang/incremental-editing]

## 3. The Gateway

OpenUI Gateway is a hosted, OpenAI-compatible API (`baseURL: https://api.thesys.dev/v1/embed`, `THESYS_API_KEY`) offering Chat Completions and Responses APIs. For every generation it: **validates** generated UI during the stream, **fixes** malformed output and schema violations on the fly, **recovers** from model/provider failures via automatic fallbacks, and **tracks** reliability in Reliability Monitoring. Tokens cost the same as direct from the provider ("zero markup, including with BYOK"). [direct, https://www.openui.com/docs/gateway]

Reliability data cited for it: "In production data from our Reliability benchmark, OpenUI Gateway fixed 96% of generations that initially failed validation." [direct, https://www.openui.com/docs/openui-lang/reliability]

For applications keeping their own inference, the **Autofix API** (`https://api.thesys.dev/v1/autofix`, model `openui/autofix`) repairs completed generations against your component-library spec; a generation that is already valid is free, each fix is charged at a flat price. [direct, https://www.openui.com/docs/openui-lang/reliability]

When is it needed? The docs recommend the Gateway "for production" but are explicit that the language and renderer themselves are provider- and service-independent, and that the Gateway "adds streaming correction and provider fallbacks without changing the component contract". [direct, https://www.openui.com/docs/openui-lang/overview]

## 4. Benchmarks & methodology caveats

**Claimed numbers** [direct, https://www.openui.com/docs/openui-lang/benchmarks]:
- Compared formats: OpenUI Lang, YAML, Vercel JSON-Render (JSONL of RFC 6902 patches), Thesys C1 JSON, across 7 scenarios encoding "exactly the same UI".
- Token totals: YAML 9,122 / Vercel JSON-Render 10,180 / Thesys C1 JSON 9,948 / **OpenUI Lang 4,800** → −47.4% / −52.8% / −51.7%. Worst-case per-scenario savings: **up to 61.4% fewer tokens than YAML, 67.1% fewer than Vercel JSON-Render, 65.4% fewer than Thesys C1 JSON** (contact-form scenario). This is the source of the marketing "up to 67% more token-efficient than JSON" on the intro page.
- Estimated latency at a modeled constant 60 tok/s: e.g. contact-form 4.90s (OpenUI) vs 12.70–14.88s (others), ~2–3× faster; intro hero: 849 vs 294 tokens, 14.2s vs 4.9s.

**Methodology** [direct, https://www.openui.com/docs/openui-lang/benchmarks]:
- Model: GPT-5.2, temperature 0, same prompts for all scenarios; **each format is derived from the same LLM output**, not independently generated per format.
- Token counting: tiktoken with the gpt-5 encoder, whitespace included; YAML counts exclude the outer fence.
- Latency is a **model**, not a measurement: "Assumes constant throughput (60 tok/s). Real latency also depends on TTFT and network."
- Reproducible: scripts live in `benchmarks/` in the repo (`pnpm generate`, `pnpm bench`).

**Caveats (researcher assessment):** [inference, except where noted]
- The comparison set is chosen by the vendor and excludes a compact hand-rolled JSON contract of the kind aurora uses (a flat `{kind, categories, series}` payload); the "67%" applies to verbose tree encodings, not to any structured format.
- "Derived from the same LLM output" avoids model-format-fidelity confounds but also means it does not test how reliably each format is *generated* — that is covered separately by the Reliability benchmark (below).
- Latency numbers are arithmetic on token counts, not observed generations. The intro page's "finishes in 4.9 vs 14.2" phrasing restates the modeled estimate.

**Generative UI Benchmark** (separate page, https://www.openui.com/benchmarks) [direct, fetched via Brave-search extraction of the live page on 2026-10-12]: 46 interfaces × 6 models × 3 formats (OpenUI Lang, A2UI, json-render), 184 runs per model. Result: OpenUI Lang rendered **99.9%** (1 blank of 1,104), with **96.9% structural validity** on average vs json-render's 82.8%; OpenUI also used the fewest tokens and cost the least on every priced model (e.g. Claude Opus 4.8: $2.27 vs $4.88 json-render). Same vendor-published caveat as above.

**Reliability benchmark** (separate from token efficiency) [direct, https://www.openui.com/docs/openui-lang/reliability]: every tested format (OpenUI, A2UI, json-render) produced incomplete generations. OpenUI completed **92.9%** of evaluated tasks with **2 blank screens across 1,104 runs**; even its strongest model pairing reached **99.5%, not 100%**. A single prompt rule improved one model's completion rate by 13 percentage points, while an incorrect example caused double-digit regressions. [interpretation: these are the vendor's own numbers; no third-party replication was found.]

## 5. Maturity & ecosystem

- **Repo:** https://github.com/thesysdev/openui — MIT license, 10,737 stars, 723 forks, 178 open issues, created 2024-12-02, last push 2026-10-12 (daily activity). [direct, https://api.github.com/repos/thesysdev/openui]
- **Packages** (monorepo `packages/`): a2ui, angular-lang, assistant-ui, browser-bundle, devtools, lang-core, langchain, observability-cloud, observability, openui-cli, react-email, react-headless, react-lang, react-ui, server. [direct, GitHub contents API]
- **Renderer package:** `@openuidev/react-lang` 0.4.1 on npm, MIT, last modified 2026-10-10 — "Define component libraries, generate LLM system prompts, and render streaming OpenUI Lang output in React — the core runtime". Prompt generation without React lives in `@openuidev/lang-core`. [direct, https://registry.npmjs.org/@openuidev/react-lang]
- **Version status:** docs list Language Specification **v0.5 (Latest)** alongside v0.1 and an Evolution Guide; npm renderer packages are 0.4.x (recent releases added `@openuidev/vue-lang` and `@openuidev/svelte-lang`, Oct 2026). Spec version ≠ package version — a discrepancy to track, not a contradiction. [direct, https://www.openui.com/docs/openui-lang + npm metadata]
- **Quick Start requires a Thesys account** for the Gateway-backed starter (`npx @openuidev/cli@latest create --template openui-cloud`). [direct, https://www.openui.com/docs/openui-lang/quickstart] The library/prompt/renderer packages themselves are usable without one. [interpretation from the overview's "do not depend on ... hosted service" statement]

## 6. How it could improve aurora

Grounded in aurora's own docs and code: aurora is a local-first file explorer + MCP artifact-preview host; agents push immutable-snapshot artifacts over MCP (`push_markdown`, `push_mermaid`, `push_chart` with a typed `chart_type`+`data` contract, `push_image`, `push_video`); one house theme; agents never control styling (ADR 0003); snapshots are copied into aurora's store at receipt time (ADR 0002); live preview via a thin WebSocket bus; React 19 + Bun. Everything in this section is **[inference]** unless a specific aurora file or OpenUI URL is cited.

### 6.1 A `push_ui` artifact type described in OpenUI Lang — **HIGH value** (effort: medium-high; risk: medium)

**Fit with the house-theme principle: strong.** OpenUI's core model is exactly aurora's ADR 0003 stance: the application defines the component library ("components your application controls" [direct, intro]), the model may only call those components, unknown components are dropped (`unknown-component` error), and the renderer maps everything to "your design system and application behavior" [direct, overview]. Concretely, aurora would define an aurora library — layout primitives (Stack/Card/Table), a `Chart` component wrapping the existing `chartContract.ts` types and house ECharts theme, a `Mermaid` component, headings/text — and agents would compose them via OpenUI Lang. The agent controls *composition and content*, never styling: styling lives in the React component implementations aurora writes. This extends ADR 0003's philosophy from "one chart per push" to "composed dashboards per push" without surrendering the house theme.

Two tensions to manage: (a) OpenUI component *props* still let the model pass arbitrary strings (e.g. text content, URLs) — the house theme constrains styling, not content, so aurora needs content-level sanitization (see 6.6); (b) the default `openuiLibrary` from `@openuidev/react-ui` is a general-purpose chat UI library [direct, quickstart] — aurora should define its own minimal library rather than adopt it wholesale, both to keep prompts small (the docs' own "limit library size" advice) and to keep styling fully house-owned.

### 6.2 Token efficiency vs aurora's typed chart JSON — **LOW–MEDIUM value** (effort: n/a; risk: none)

Aurora's chart payloads are already compact flat data (`{kind:"categorical", categories:[...], series:[{name, values:[...]}]}` — `lib/chartContract.ts`) with no repeated `"component"/"props"/"children"` keys. OpenUI's measured 47–67% savings are against verbose tree encodings (JSON-Patch JSONL, YAML spec payload, normalized component-tree JSON) [direct, benchmarks]. For a single chart artifact, an OpenUI Lang rendering of the same data would add a line per element but save little — the data arrays dominate either way. **[inference]** The token win becomes real only for *multi-element* artifacts (dashboards with N charts + headings + text), where per-element structural overhead would otherwise be paid N times if aurora encoded layout as JSON. Conclusion: adopt OpenUI Lang for expressiveness/composition (6.1), not primarily for token savings on existing artifact types.

### 6.3 Reuse `@openuidev/react-lang` vs writing aurora's own parser — **reuse; MEDIUM-HIGH value** (effort: low vs high; risk: low-medium)

- **License is not a blocker:** repo and npm package are MIT. [direct, GitHub/npm API]
- The full v0.5 language is nontrivial to reimplement: positional-args mapping via Zod key order, forward references, streaming re-parse, orphan tracking, statement-merge for edit mode, `@builtin` evaluation, error codes. [direct, spec v0.5 + renderer] Writing this from the spec is weeks of work and a permanent correctness liability. **[inference]**
- `@openuidev/react-lang` is the "core runtime for OpenUI generative UI" and aurora is already React 19; `@openuidev/lang-core` (prompt generation) is React-free. [direct, npm description; system-prompts page] Compatibility of the 0.4.1 package with React 19 + Bun specifically is **unverified** (missing evidence).
- Recommendation: adopt `@openuidev/react-lang` pinned to an exact version, wrapped behind aurora's own `push_ui` rendering path so the dependency can be swapped; do not adopt `@openuidev/react-ui`'s default library wholesale (styling ownership). **[inference]**

### 6.4 Streaming / incremental editing vs aurora's snapshot + `artifact_id` replace — **partial adoption; MEDIUM value**

The two models operate at different layers and do not conflict. Aurora's artifact model (immutable snapshots, `artifact_id` = idempotent in-place replace — ADR 0002, `lib/mcpSurface.ts`) governs *persistence and identity*; OpenUI's streaming parser and `editMode` merge govern *how one artifact's content is produced and rendered*. Compatible design: each `push_ui` (initial or patch) lands as a new immutable snapshot of the OpenUI Lang source; within a single push the renderer streams lines progressively; a patch push replaces the snapshot and the renderer applies OpenUI's merge rules to render the merged result. **[inference]** What aurora should *not* adopt is OpenUI's mutable-merge persistence across turns (patch edits the live program) — that would break ADR 0002's no-TTL, explicit-deletion model. Value: streaming gives the live preview perceived-speed benefits the docs center their UX story on [direct, intro]; incremental patches cut agent tokens on dashboard iteration [direct, incremental-editing: up to 85% fewer tokens]. But aurora's pushes are one-shot tool calls, not an open chat stream, so the streaming benefit is smaller than in a chat app.

### 6.5 Gateway streaming validation/repair vs aurora's typed contract validation — **LOW value / mostly orthogonal** (risk: high if adopted)

The Gateway is a hosted service at `api.thesys.dev` requiring a `THESYS_API_KEY` [direct, gateway + reliability pages]. That conflicts with aurora's local-first, no-auth, "localhost is the security boundary" posture (README) and would egress agent content to a third-party cloud — the opposite of the project's design center. It is also *orthogonal* in function: aurora already runs its validation loop at the tool boundary — zod-enforced contracts with actionable `isError` messages the agent can correct against (`chartContractError`, `toolError` in `lib/mcpSurface.ts`) — which is the same self-correction pattern the OpenUI renderer's LLM-friendly `onError` enables [direct, renderer page], just batched at tool-response granularity rather than mid-stream. Relevant idea worth borrowing without the service: surface aurora-side parse/validation errors back to the agent in a structured, hint-bearing form so failed `push_ui` calls self-correct. **[inference]** Autofix is also hosted (flat-priced API), so it does not fit either.

### 6.6 Risks

- **Dependency maturity (medium):** `@openuidev/react-lang` is 0.4.x from a single vendor whose docs push their hosted Gateway; spec is at v0.5 while packages are 0.4.x [direct]. Mitigating evidence: MIT, 10.7k stars, daily commits, multi-framework expansion (vue-lang/svelte-lang) [direct, GitHub/npm metadata]. Mitigation: pin versions, isolate behind aurora's own components, keep the OpenUI Lang *source* as the stored artifact so the corpus outlives any renderer.
- **Security of rendering model-generated UI descriptions (medium):** materially safer than rendering model HTML — the agent can only invoke aurora-defined components; invalid statements are dropped, not rendered [direct, intro/renderer]. Residual exposure is content-level: URLs in `@OpenUrl`/link-like props, image URLs, long strings into text components. Aurora must audit/allowlist what its library components do with model-supplied strings (e.g. only `https://` image sources, as even OpenUI's own quickstart example guards). **[inference, plus direct quickstart evidence of the guard pattern]**
- **MCP tool surface growth (low):** ADR 0003 already commits to one tool per artifact type, append-mostly. One new `push_ui` tool fits that policy; the larger long-term contract is the *component library spec itself*, which becomes agent-facing — new components are additive, but breaking prop changes would strand installed agents, exactly like tool-schema changes. **[inference from ADR 0003]**

### Value summary

| Opportunity | Value | Effort | Risk |
| --- | --- | --- | --- |
| 6.1 `push_ui` with aurora-owned component library | **High** | Medium-high | Medium |
| 6.3 Reuse `@openuidev/react-lang` (MIT) vs own parser | **Medium-high** (enabler for 6.1) | Low | Low-medium |
| 6.4 Streaming render + patch-as-new-snapshot | Medium | Medium | Low |
| 6.2 Token efficiency vs current chart JSON | Low-medium (dashboards only) | — | — |
| 6.6 Borrow structured-error self-correction loop | Medium | Low | Low |
| 6.5 OpenUI Gateway / Autofix (hosted) | Low / not applicable | — | High (conflicts with local-first) |

## 7. Sources

### Kept (primary, fetched 2026-10-12)
- Introduction — https://www.openui.com/docs/openui-lang
- Overview — https://www.openui.com/docs/openui-lang/overview
- Quick Start — https://www.openui.com/docs/openui-lang/quickstart
- Defining Components — https://www.openui.com/docs/openui-lang/defining-components
- System Prompts — https://www.openui.com/docs/openui-lang/system-prompts
- The Renderer — https://www.openui.com/docs/openui-lang/renderer
- Interactivity — https://www.openui.com/docs/openui-lang/interactivity
- Reliability — https://www.openui.com/docs/openui-lang/reliability
- Architecture — https://www.openui.com/docs/openui-lang/architecture
- Reactive State — https://www.openui.com/docs/openui-lang/reactive-state
- Queries & Mutations — https://www.openui.com/docs/openui-lang/queries-mutations
- Incremental Editing — https://www.openui.com/docs/openui-lang/incremental-editing
- Built-in Functions — https://www.openui.com/docs/openui-lang/builtins
- Language Specification v0.5 — https://www.openui.com/docs/openui-lang/specification-v05
- Gateway — https://www.openui.com/docs/gateway
- Benchmarks — https://www.openui.com/docs/openui-lang/benchmarks
- Generative UI Benchmark — https://www.openui.com/benchmarks
- GitHub repo API — https://api.github.com/repos/thesysdev/openui
- npm registry — https://registry.npmjs.org/@openuidev/react-lang
- Aurora local sources: `README.md`, `CONTEXT.md`, `docs/adr/0002-immutable-snapshot-artifact-store.md`, `docs/adr/0003-typed-artifact-contracts.md`, `lib/mcpSurface.ts`, `lib/chartContract.ts` (this worktree)

### Rejected / deprioritized
- v0.1 spec and Evolution Guide pages — not fetched; v0.5 suffices for this evaluation (noted under missing evidence).
- Gateway sub-pages (Pricing, BYOK, Hosted Tools, Conversations API) — not fetched; Gateway was evaluated as "not applicable to aurora", so pricing detail was unnecessary.
- openui.com demos and the Shadcn Chat / React Email example pages — marketing surfaces, no decision-relevant content.
- Blog posts / third-party coverage — none consulted; all claims trace to primary docs or registry APIs.

### Missing evidence
- No **independent (non-Thesys) replication** of the token-efficiency or reliability benchmarks; both are vendor-published (reproducible scripts exist in the repo but were not run).
- Gateway **pricing page** not fetched (relevant only if aurora ever revisits hosted repair).
- `@openuidev/react-lang` **0.4.1 compatibility with React 19 and Bun** unverified — no tested integration exists.
- License of `@openuidev/react-ui` specifically was inferred MIT from the monorepo's MIT license, not separately confirmed on npm.
- Exact per-scenario prompts of the benchmark (beyond "same system prompt and user prompt for every scenario") were not in the fetched content.

### Contradictions
- **"Up to 67%" vs hero "65% fewer tokens"** (intro page): both trace to the same benchmark — 67.1% is the best case vs Vercel JSON-Render (contact-form), while the hero's 849→294 tokens (contact-form vs "JSON Format") computes to 65.4%, which matches the vs-Thesys-C1 column. A display inconsistency, not a data conflict. [direct, intro + benchmarks]
- **Spec v0.5 "Latest" vs npm packages 0.4.x** — version schemes differ across spec and packages; the docs do not explain the mapping. Recorded as a discrepancy to track, not resolved. [direct, docs nav + npm]
- No other contradictions found between pages.
