# push_ui description budget is 1,300 tokens, and aurora validates child component types itself

The `push_ui` tool description stays generated from the component library (ADR-0006), but two sections of the OpenUI-generated prompt are stripped by exact heading — `## Hoisting & Streaming (CRITICAL)` (aurora renders whole snapshots with `isStreaming={false}`; streaming was rejected in ADR-0006) and `## Important Rules` (it tells agents to use tables and forms aurora does not have) — and the hard cap rises from 800 to **1,300** tokens (`gpt-tokenizer` `encode`, test-enforced; target ≤ 1,150). Separately, aurora checks that every element in a `children` array is a member of its parent's schema union (error code `child-type`), deriving the allowed set from `auroraUiLibrary.toJSONSchema()`, with one explicit exception: `Stack` may nest `Stack`.

Evidence (2026-11-17, `@openuidev/react-lang` / `lang-core` 0.4.1): the five-component description measured 794/800 tokens before the digest components (#78); the full eleven-component library plus a digest worked example measured 1,295 raw and 1,122 after the strip. `PromptOptions` has no switch to omit those sections. The parser accepted `Card([Mermaid(…)])` and `Card([Stack(…)])` with zero errors — union member types on `children` are not enforced upstream.

## Considered Options

- **Keep the 800 cap by dropping the worked example or descriptions** — rejected: signatures alone exceed 800 once the digest set lands, and agents compose worse without an example.
- **Hand-write a shorter description** — rejected: breaks the single-source-of-truth rule that keeps docs and validation from drifting.
- **A separate tool or library for briefings** — rejected: no new MCP tools (#78), and a second library duplicates the validation and patch-merge path.
- **Self-referencing `Stack` via `z.lazy`** — rejected: the generated signature renders the member as `any`; nesting is allowed by the aurora-side check instead and stated in `Stack`'s description.
- **A hand-maintained allowed-children map** — rejected: drifts from the zod unions.

## Consequences

- Widening a union (e.g. `Card.children` to `Text | Chart | Mermaid`) is now a real contract change, not documentation only.
- Stored programs that nested a component outside its union now render with the in-page error block.
