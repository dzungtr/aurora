# Agents compose UI artifacts against an aurora-owned component library, never styling

`push_ui` accepts an OpenUI Lang program composed against a small aurora-defined component library (`Stack`, `Card`, `Text`, `Chart`, `Mermaid`), extending ADR 0003's "agents never control styling" principle from one chart per push to composed dashboards: the agent controls composition and content; styling lives entirely in aurora's React component implementations. The OpenUI renderer is adopted as an exact-pinned dependency behind a swap boundary (one library-definition module, one viewer module), with the framework-free core used server-side for push-time validation and patch merging; the stored snapshot is the program source itself, so the artifact corpus outlives any renderer version. Patch mode merges changed statements server-side and stores the **merged full program** as the new immutable snapshot — deltas are never stored (ADR 0002 intact) — and the response echoes the final statement names so agents can chain patches without the old program in context.

## Considered Options

- **Writing our own parser** for the language spec — rejected: weeks of work and a permanent correctness liability for a nontrivial grammar (positional Zod-key-ordered args, forward references, streaming re-parse, statement merge).
- **Adopting the OpenUI default component library** — rejected: it is a general-purpose chat UI library; aurora's library stays minimal and house-owned, and the tool description is generated from it (single source of truth, no drift, hard token budget).
- **Streaming render / server pre-render / the hosted OpenUI Gateway or Autofix** — rejected: pushes are atomic (streaming saves nothing), aurora renders client-side, and hosted repair services conflict with the local-first, localhost-is-the-boundary posture.

## Consequences

- Programs are capped server-side (statement count and per-string length) with actionable errors; dropped statements surface in a visible error block rather than silently hiding agent mistakes.
- The component library is an agent-facing contract like the tool schemas: new components are additive, breaking prop changes strand installed agents (append-mostly, per ADR 0003).
- Any future URL-bearing component must accept `https://` only and fetch through the existing size-capped, server-side snapshot path — never a live reference (ADR 0002).
