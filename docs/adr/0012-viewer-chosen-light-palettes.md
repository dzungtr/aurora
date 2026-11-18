# Light mode offers viewer-chosen palettes; agents still never control styling

Light mode gains four palettes — Paper (the default, identical to the previous light theme), Broadsheet, Slate & coral, Cobalt & tangerine — picked by the viewer in the shared top bar and remembered per browser (epic #97, spec #98 D11). This amends the "single house theme" wording of ADR-0003 and ADR-0006 for light mode only. The principle those ADRs protect is unchanged: a palette is a viewer preference applied by aurora at render time, and no tool parameter, artifact field or UI-program statement can select or influence it. Every artifact still renders with aurora-owned styling; the viewer now chooses which of aurora's own light looks that is. Dark mode stays single.

## Considered Options

- **Keep one light theme** — rejected by the owner: the design bundle's palettes are wanted, and they cost nothing in agent-facing contract.
- **Let the agent or the channel choose a palette** — rejected: hands styling back to the agent, the exact thing ADR-0003/0006 exist to prevent.
- **Palettes in dark mode too** — rejected: the design defines light palettes only; dark stays the single reference look.
- **Store the choice server-side** — rejected: aurora has no user state and no auth (ADR-0007); it is a per-browser preference like the theme toggle.

## Consequences

- "House theme" now means: one dark look, and a small aurora-owned set of light looks. Chart colours follow the palette; Mermaid variables and artifact-type chip colours do not.
- Palettes are CSS token overrides scoped to light mode. New components must style through tokens, not hard-coded colours, or they will ignore the palette.
- The same artifact can look different in two browsers. Screenshots are not a stable record of colour; the snapshot (ADR-0002) is unaffected.
