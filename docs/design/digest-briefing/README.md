# Digest briefing — design reference

`Aurora Feed.dc.html` is the UI mockup attached to epic #78, kept here as a **read-only reference** for spec #86. It is a design-canvas file: it depends on a runtime and design-system bundle that are not committed, so it does not render standalone. Read its markup and data; do not run it.

The mockup's inline styles are mockup mechanics. Aurora renderers use classes in `src/styles.css` (spec #86, D12).

## Line map

| Lines | Region | Aurora component |
|---|---|---|
| 27–46 | Theme tokens `--a-*` (light, dark) | Digest tokens in `src/styles.css` |
| 173–191 | Masthead: kicker, date, scanned/kept/min, Live pill | `BriefingHeader` |
| 193–203 | Patch timeline under the masthead | `BriefingHeader.passes` |
| 205–206, 971 | Hero + rail grid (`1.7fr / 1fr`; single column when no rail) | Row `Stack` containing a hero `DigestCard` |
| 208–251 | Hero card, expanded region, original-source link | `DigestCard` variant `hero` |
| 253–289 | "Also today" rail | `SectionHeader` + `DigestCard` variant `rail` |
| 292–334 | Domain sections with one-row items | `SectionHeader` + `DigestCard` variant `list` |
| 336–364 | Tracked threads with history | `ThreadUpdate` |
| 366–385 | Skipped list, collapsed by default | `SkipList` |
| 387–392 | End line | `DoneMarker` |
| 479–679 | Sample briefing data for four topics | Fixture material for tests |
| 829–858 | The OpenUI program the mockup implies | Shape reference only — aurora's syntax is positional (see the generated `push_ui` description) |

## Feed chrome (spec #98)

Spec #86 (D11) left the chrome around the briefing unbuilt. Epic #97 / spec #98 builds it as the **Feed** (`/feed/<channel>`), plus the light palette picker.

| Lines | Region | Spec #98 |
|---|---|---|
| 73–82 | Top-bar nav: Feed / Artifacts | D15 |
| 86–93, 692–702, 913–924 | Light palette picker and `PALETTES` | D11, ADR-0012 |
| 107–130 | Channel tabs (the per-topic icons and labels are not followed) | D1, D2, D4, D16 |
| 138–149 | Toolbar: Live, Program, Copy link | D7, D23 |
| 154–167 | Archived day (placeholder not followed — the real artifact renders under a banner) | D6, D18 |
| 399–424 | Channel stack aside (the "kept · patches" line is not followed) | D9 |
| 426–454 | Program drawer (syntax colouring not followed) | D8 |
| 457–466 | Toast | D20 |

## Out of scope

The "Simulate agent patch" button (lines 468–472) is a mockup control. Do not build it.
