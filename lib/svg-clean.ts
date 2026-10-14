"use client";
/** Strips anything active from an AI-drawn SVG before it is shown. Runs in the browser. */
export function cleanSvg(raw: string): { svg: string; title: string } | null {
  const m = String(raw).match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return null;
  const doc = new DOMParser().parseFromString(m[0], "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") return null;
  root.querySelectorAll("script,foreignObject,image,iframe,a,animate,set,animateTransform,animateMotion,feImage").forEach((n) => n.remove());
  for (const n of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const a of Array.from(n.attributes)) {
      const name = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (name.startsWith("on")) n.removeAttribute(a.name);
      else if ((name === "href" || name === "xlink:href") && !v.startsWith("#")) n.removeAttribute(a.name);
      else if (/url\(\s*['"]?(?!#)/.test(v)) n.removeAttribute(a.name);
    }
  }
  root.querySelectorAll("style").forEach((s) => {
    s.textContent = (s.textContent || "").replace(/@import[^;]*;?/gi, "").replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none");
  });
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.setAttribute("width", "1024");
  root.setAttribute("height", "1024");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 512 512");
  const title = root.querySelector("title")?.textContent?.trim() || "An illustration";
  return { svg: new XMLSerializer().serializeToString(root), title };
}
