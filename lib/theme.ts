/** Light is the default; dark mode is a switch in the top bar, remembered in this browser. */
export type Theme = "light" | "dark";
export const THEME_KEY = "theme3";
export const currentTheme = (): Theme => (typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#0B0A12" : "#F7F5FC");
  window.dispatchEvent(new CustomEvent("autistik-theme", { detail: t }));
}
