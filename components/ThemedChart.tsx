"use client";
/**
 * A DexScreener chart that follows the site's theme: light on the white pages, dark in dark mode, and it switches
 * when someone flips the theme. `src` is the embed link; any theme=/chartTheme= in it is replaced.
 */
import { useEffect, useState } from "react";
import { currentTheme, type Theme } from "@/lib/theme";

export default function ThemedChart({ src, title, className = "chart" }: { src: string; title: string; className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(currentTheme());
    const o = new MutationObserver(() => setTheme(currentTheme()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => o.disconnect();
  }, []);
  // Until we know the theme, an empty box in the page's own colour (no dark flash on a white page).
  if (!theme) return <div className={className || undefined} style={{ width: "100%", height: "100%", minHeight: 300 }} aria-hidden="true" />;
  const u = new URL(src);
  u.searchParams.set("theme", theme);
  if (u.searchParams.has("chartTheme")) u.searchParams.set("chartTheme", theme);
  return <iframe key={theme} className={className || undefined} title={title} src={u.toString()} loading="lazy" referrerPolicy="no-referrer" />;
}
