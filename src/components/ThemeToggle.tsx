import { Icon } from "./Icon";
import { setTheme, useTheme } from "../lib/themeStore";

/** Sun/moon segmented control, shared by the explorer and preview top bars. */
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <div className="aur-themeseg">
      <button
        className={"aur-themeseg__btn" + (theme === "light" ? " is-active" : "")}
        onClick={() => setTheme("light")}
        title="Light theme"
      >
        <Icon name="uil:sun" size={14} />
      </button>
      <button
        className={"aur-themeseg__btn" + (theme === "dark" ? " is-active" : "")}
        onClick={() => setTheme("dark")}
        title="Dark theme"
      >
        <Icon name="uil:moon" size={14} />
      </button>
    </div>
  );
}
