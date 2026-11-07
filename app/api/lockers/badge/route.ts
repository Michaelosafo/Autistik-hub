import { LOCKER_CHAINS, isLockerChain } from "@/lib/locker";
import { lockById } from "@/lib/locker-server";

export const runtime = "nodejs";
export const revalidate = 300;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const amt = (v: string) => { const n = Number(v); return n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: 4 }); };

/** A small image of a lock (read live from the chain) that projects can post anywhere and link to its certificate. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const chain = q.get("chain") || "", id = Number(q.get("id"));
  const l = isLockerChain(chain) ? await lockById(chain, id) : null;
  const locked = l && !l.done && l.unlockDate * 1000 > Date.now();
  const line1 = !l ? "Lock not found" : l.done ? `${l.name}: lock released` : `${l.pctOfSupply !== null ? `${l.pctOfSupply.toFixed(1)}% · ` : ""}${amt(l.left)} ${l.name}`;
  const line2 = !l ? "AUTISTIK Locker" : locked ? `Locked until ${new Date(l.unlockDate * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })} · ${LOCKER_CHAINS[chain as keyof typeof LOCKER_CHAINS].name}` : `Unlockable · ${LOCKER_CHAINS[chain as keyof typeof LOCKER_CHAINS].name}`;
  const accent = locked ? "#22c55e" : "#94a3b8";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="84" viewBox="0 0 420 84" role="img" aria-label="${esc(line1)}">
  <rect width="420" height="84" rx="14" fill="#0f172a"/>
  <rect x="1" y="1" width="418" height="82" rx="13" fill="none" stroke="${accent}" stroke-opacity=".6"/>
  <circle cx="42" cy="42" r="24" fill="${accent}" fill-opacity=".15"/>
  <text x="42" y="51" font-size="26" text-anchor="middle">${locked ? "🔒" : "🔓"}</text>
  <text x="80" y="35" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="17" font-weight="700" fill="#f8fafc">${esc(line1.slice(0, 40))}</text>
  <text x="80" y="57" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" fill="#cbd5e1">${esc(line2.slice(0, 52))}</text>
  <text x="80" y="74" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="10.5" fill="${accent}">✔ AUTISTIK Locker · no owner · verify live at autistik.io</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" } });
}
