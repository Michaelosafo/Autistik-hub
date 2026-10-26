/**
 * Switches the whole site into another language in the browser: every piece of text on the page (and new text as it
 * appears) is translated through /api/translate and written back as plain text. Originals are kept, so switching
 * back to English (or to another language) is instant. Addresses, prices, tickers, code and anything marked
 * .notranslate / translate="no" / .mono are never touched.
 */
const SKIP = 'script,style,noscript,code,pre,textarea,input,select,option,svg,.notranslate,[translate="no"],.mono,[contenteditable="true"]';
const ATTRS = ["placeholder", "title", "aria-label"] as const;
const KEY = "site-lang";

let lang = "en";
let observer: MutationObserver | null = null;
const cache = new Map<string, string>(); // original -> translation, for the current language
const origText = new WeakMap<Text, string>();
const written = new WeakMap<Text, string>();
const origAttr = new WeakMap<Element, Record<string, string>>();
const touchedText = new Set<Text>();
const touchedEl = new Set<Element>();
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export const currentLang = () => lang;
export function savedLang(): string {
  try { return localStorage.getItem(KEY) || "en"; } catch { return "en"; }
}

const worth = (s: string) => {
  const t = s.trim();
  if (t.length < 2 || t.length > 500 || !/\p{L}{2}/u.test(t)) return false;
  if (/^[$#@]?[A-Z0-9]{2,10}$/.test(t)) return false; // tickers, codes
  if (/^(0x[0-9a-fA-F]{6,}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(t)) return false; // addresses
  if (/^https?:\/\//.test(t)) return false;
  return true;
};
const skipped = (el: Element | null) => !el || !!el.closest(SKIP);

function loadCache(l: string) {
  cache.clear();
  try { const o = JSON.parse(localStorage.getItem(`tr:${l}`) || "{}"); for (const k in o) cache.set(k, o[k]); } catch { /* none yet */ }
}
function saveCache(l: string) {
  try {
    const entries = [...cache.entries()].slice(-3000); // keep the browser copy small
    localStorage.setItem(`tr:${l}`, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage full or private mode */ }
}

function translateText(node: Text) {
  const now = node.nodeValue ?? "";
  // React changed the text since we last wrote it: that's the new original.
  if (written.get(node) !== now) origText.set(node, now);
  const src = origText.get(node) ?? now;
  const key = src.trim();
  if (!worth(key)) return;
  const tr = cache.get(key);
  if (tr === undefined) { pending.add(key); return; }
  const out = src.replace(key, tr);
  if (now !== out) { written.set(node, out); node.nodeValue = out; }
  touchedText.add(node);
}
function translateAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const saved = origAttr.get(el) || {};
    if (!(a in saved) || (saved[`_${a}`] !== v)) saved[a] = v; // new original
    origAttr.set(el, saved);
    const key = saved[a].trim();
    if (!worth(key)) continue;
    const tr = cache.get(key);
    if (tr === undefined) { pending.add(key); continue; }
    saved[`_${a}`] = tr;
    if (v !== tr) el.setAttribute(a, tr);
    touchedEl.add(el);
  }
}
function walk(root: Node) {
  if (lang === "en") return;
  if (root.nodeType === Node.TEXT_NODE) { if (!skipped((root as Text).parentElement)) translateText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (skipped(el)) return;
  translateAttrs(el);
  el.querySelectorAll("[placeholder],[title],[aria-label]").forEach((e) => { if (!skipped(e)) translateAttrs(e); });
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (!skipped((n as Text).parentElement)) translateText(n as Text);
  schedule();
}

function schedule() {
  if (!pending.size || timer) return;
  timer = setTimeout(flush, 250);
}
async function flush() {
  timer = null;
  const l = lang;
  const all = [...pending]; pending.clear();
  for (let i = 0; i < all.length; i += 60) {
    const chunk = all.slice(i, i + 60);
    try {
      const r = await fetch("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang: l, texts: chunk }) });
      const d = await r.json();
      if (l !== lang) return;
      for (const k of chunk) cache.set(k, d?.map?.[k] ?? k); // untranslatable: keep the original, don't ask again
    } catch { for (const k of chunk) if (!cache.has(k)) cache.set(k, k); }
  }
  if (l !== lang) return;
  saveCache(l);
  walk(document.body);
}

function restore() {
  for (const n of touchedText) { const o = origText.get(n); if (o !== undefined && n.isConnected) { written.set(n, o); n.nodeValue = o; } }
  for (const e of touchedEl) { const o = origAttr.get(e); if (o) for (const a of ATTRS) if (a in o) e.setAttribute(a, o[a]); }
  touchedText.clear(); touchedEl.clear();
}

/** Switches the page to `l` (a code from lib/langs.ts) and remembers it on this device. */
export function setLang(l: string) {
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  restore();
  lang = l;
  document.documentElement.lang = l;
  window.dispatchEvent(new CustomEvent("site-lang", { detail: l }));
  if (l === "en") { observer?.disconnect(); observer = null; return; }
  loadCache(l);
  walk(document.body);
  if (!observer) {
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") { const t = m.target as Text; if (written.get(t) !== t.nodeValue && !skipped(t.parentElement)) translateText(t); }
        else if (m.type === "attributes") { if (!skipped(m.target as Element)) translateAttrs(m.target as Element); }
        else m.addedNodes.forEach((n) => walk(n));
      }
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  }
}
