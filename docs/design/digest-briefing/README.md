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

## Out of scope (spec #86, D11)

Top bar nav, topic tabs (lines 107–130), briefing toolbar (138–149), archived-day view (154–167), channel-stack aside (399–424), program drawer (426–454), toast/simulate controls (457–472), and the light palette picker. Do not build these.
