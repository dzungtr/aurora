import { Icon } from "./Icon";
import { PALETTE_ORDER, PALETTES, setPalette, usePalette } from "../lib/paletteStore";
import { useTheme } from "../lib/themeStore";

/** Light-palette swatches for the shared top bar; light theme only. */
export function PalettePicker() {
  const theme = useTheme();
  const active = usePalette();
  if (theme !== "light") return null;
  return (
    <div className="aur-palette" title="Light palette">
      <Icon name="uil:palette" size={14} />
      {PALETTE_ORDER.map((id) => {
        const p = PALETTES[id];
        return (
          <button
            key={id}
            className={"aur-palette__swatch" + (id === active ? " is-active" : "")}
            style={{ background: `linear-gradient(135deg, ${p.bg} 50%, ${p.swatch} 50%)` }}
            title={p.label}
            aria-label={p.label}
            aria-pressed={id === active}
            onClick={() => setPalette(id)}
          />
        );
      })}
      <span className="aur-palette__label">{PALETTES[active].label}</span>
    </div>
  );
}
