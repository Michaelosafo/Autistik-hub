/**
 * Admin → Everything happening: one feed of what's going on across the site, plus the health of the scheduled jobs.
 * SERVER ONLY. Reads with the service key, so it checks for the owner (with their 2-step code) itself before reading
 * anything: hiding the page isn't the only lock.
 */
import { adminState } from "@/lib/admin";
import { supabaseService } from "@/lib/supabase/server";
import { recentMemberWallets } from "@/lib/privy-server";
import { XCHAIN_BY_KEY } from "@/lib/bridge-chains";
import { CHAINS } from "@/lib/launchpad";

export type FeedKind = "join" | "signin" | "2fa" | "wallet" | "swap" | "liquidity" | "launch" | "lock" | "other";
export type FeedRow = { at: number; kind: FeedKind; icon: string; who: string; text: string; href?: string; external?: boolean };
export type Health = { name: string; what: string; ok: boolean | null; last: number | null; note: string };

export type AdminActivity = {
  tiles: { label: string; value: string; sub?: string }[];
  feed: FeedRow[];
  health: Health[];
  launches: { at: number; chain: string; symbol: string; name: string; lp: string; source: string; href: string }[];
  notes: string[];
};

const DAY = 86_400_000;
const explorerTx = (chain: string | null, tx: string | null) => {
  if (!chain || !tx) return undefined;
  const base = XCHAIN_BY_KEY[chain]?.explorer ?? (CHAINS as Record<string, { explorer: string }>)[chain]?.explorer;
  return base ? `${base}/tx/${tx}` : undefined;
};
const chainName = (k: string) => XCHAIN_BY_KEY[k]?.name ?? (CHAINS as Record<string, { name: string }>)[k]?.name ?? k;
const maskEmail = (e: string | null | undefined) => {
  if (!e) return "";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${u.length > 2 ? "…" : ""}@${d}`;
};
const ICON: Record<string, string> = {
  swap: "🔁", liquidity: "💧", "lp-burn": "🔥", launch: "🚀", launchpad: "🛠", lock: "🔒", locker: "🛠",
  search: "🔎", pin: "📌", unpin: "📍", pro: "💎", report: "🤖", alerts: "📲", "momentum-alerts": "⚡",
};
const KIND_OF: Record<string, FeedKind> = { swap: "swap", liquidity: "liquidity", "lp-burn": "liquidity", launch: "launch", launchpad: "launch", lock: "lock", locker: "lock" };

/** Throws for anyone who isn't the owner with their 2-step code entered. */
export async function adminActivity(): Promise<AdminActivity> {
  if (!(await adminState()).admin) throw new Error("Admin only.");
  const sb = supabaseService();
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since1 = new Date(now - DAY).toISOString();
  const notes: string[] = [];

  const [acc, acts, swaps1, swaps7, liq7, launches, launches7, scanner, momentum, tracked, checked1h, traded1h, cron, wallets] = await Promise.all([
    sb.rpc("admin_accounts", { p_limit: 300 }),
    sb.from("activity_log").select("*").order("at", { ascending: false }).limit(250),
    sb.from("activity_log").select("id", { count: "exact", head: true }).eq("kind", "swap").gt("at", since1),
    sb.from("activity_log").select("id", { count: "exact", head: true }).eq("kind", "swap").gt("at", since7),
    sb.from("activity_log").select("id", { count: "exact", head: true }).eq("kind", "liquidity").gt("at", since7),
    sb.from("launches").select("created_at,chain,token,symbol,name,lp_lock,source").order("created_at", { ascending: false }).limit(12),
    sb.from("launches").select("id", { count: "exact", head: true }).gt("created_at", since7),
    sb.from("analytics_state").select("last_run,day,api_calls").eq("id", 1).maybeSingle(),
    sb.from("momentum_state").select("last_run").eq("id", 1).maybeSingle(),
    sb.from("tracked_tokens").select("token", { count: "exact", head: true }).gt("viewed_at", since7),
    sb.from("tracked_tokens").select("token", { count: "exact", head: true }).gt("checked_at", new Date(now - 3_600_000).toISOString()),
    sb.from("tracked_tokens").select("token", { count: "exact", head: true }).gt("trades_at", new Date(now - 3_600_000).toISOString()),
    sb.rpc("admin_cron_health"),
    recentMemberWallets(300),
  ]);

  // ---------- Accounts: sign-ups, sign-ins, 2-step ----------
  type Acct = { id: string; email: string | null; alias: string | null; created_at: string; last_sign_in_at: string | null; confirmed: boolean; mfa_at: string | null };
  let accounts: Acct[] = [];
  let a: Record<string, number> = {};
  if (!acc.error && acc.data) {
    a = acc.data as Record<string, number>;
    accounts = ((acc.data as { rows?: Acct[] }).rows || []);
  } else {
    // Before supabase/admin-activity.sql is run: the newest 1,000 accounts straight from Supabase Auth.
    notes.push("Run admin-activity.sql in Supabase for exact member counts and scheduled-job health.");
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = data?.users || [];
    const { data: names } = await sb.from("profiles").select("id,alias").in("id", users.slice(0, 300).map((u) => u.id));
    accounts = users.map((u) => ({
      id: u.id, email: u.email ?? null, alias: (names || []).find((n) => n.id === u.id)?.alias ?? null,
      created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null, confirmed: !!u.email_confirmed_at,
      mfa_at: u.factors?.find((f) => f.status === "verified")?.updated_at ?? null,
    }));
    const t = (s: string | null, ms: number) => !!s && now - Date.parse(s) < ms;
    a = {
      total: users.length, confirmed: accounts.filter((x) => x.confirmed).length,
      joined_1d: accounts.filter((x) => t(x.created_at, DAY)).length, joined_7d: accounts.filter((x) => t(x.created_at, 7 * DAY)).length,
      signed_1d: accounts.filter((x) => t(x.last_sign_in_at, DAY)).length, signed_7d: accounts.filter((x) => t(x.last_sign_in_at, 7 * DAY)).length,
      with_2fa: accounts.filter((x) => x.mfa_at).length,
    };
  }
  const nameOf = new Map(accounts.map((x) => [x.id, x.alias || maskEmail(x.email) || "Member"]));
  const byEmail = new Map(accounts.filter((x) => x.email).map((x) => [x.email!.toLowerCase(), x.alias || maskEmail(x.email)]));

  const feed: FeedRow[] = [];
  for (const x of accounts) {
    const who = x.alias || maskEmail(x.email) || "Member";
    feed.push({ at: Date.parse(x.created_at), kind: "join", icon: "👋", who, text: `Joined${x.email ? ` with ${maskEmail(x.email)}` : ""}${x.confirmed ? "" : " · email not confirmed yet"}`, href: `/members/${x.id}` });
    // A sign-in within a minute of joining is the sign-up itself.
    if (x.last_sign_in_at && Date.parse(x.last_sign_in_at) - Date.parse(x.created_at) > 60_000) feed.push({ at: Date.parse(x.last_sign_in_at), kind: "signin", icon: "🔑", who, text: "Signed in" });
    if (x.mfa_at) feed.push({ at: Date.parse(x.mfa_at), kind: "2fa", icon: "🛡️", who, text: "Turned on 2-step verification (authenticator app)" });
  }

  // ---------- Built-in wallets (Privy) ----------
  if (wallets) {
    for (const w of wallets.rows) {
      const parts = [w.evm && `EVM ${w.evm.slice(0, 6)}…${w.evm.slice(-4)}`, w.sol && `Solana ${w.sol.slice(0, 4)}…${w.sol.slice(-4)}`].filter(Boolean).join(" · ");
      feed.push({ at: w.at, kind: "wallet", icon: "👛", who: (w.email && byEmail.get(w.email.toLowerCase())) || maskEmail(w.email) || "Member", text: `Wallet created: ${parts}` });
    }
  } else notes.push("Built-in wallets aren't shown: PRIVY_APP_ID and PRIVY_APP_SECRET aren't both set in Vercel.");

  // ---------- Swaps, liquidity, launches, locks and the rest ----------
  for (const r of (acts.data || []) as { at: string; user_id: string | null; kind: string; label: string | null; link: string | null; chain?: string | null; tx?: string | null }[]) {
    const tx = explorerTx(r.chain ?? null, r.tx ?? null);
    feed.push({
      at: Date.parse(r.at), kind: KIND_OF[r.kind] || "other", icon: ICON[r.kind] || "•",
      who: (r.user_id && nameOf.get(r.user_id)) || (r.user_id ? "Member" : "Visitor"),
      text: (r.label || r.kind) + (r.chain && !(r.label || "").includes(chainName(r.chain)) ? ` · ${chainName(r.chain)}` : ""),
      href: tx || r.link || undefined, external: !!tx,
    });
  }
  feed.sort((x, y) => y.at - x.at);

  // ---------- Health ----------
  const ago = (t: number | null) => (t == null ? "never" : `${Math.max(0, Math.round((now - t) / 60000))} min ago`);
  const lastScan = scanner.data?.last_run ? Date.parse(scanner.data.last_run) : null;
  const lastMom = momentum.data?.last_run ? Date.parse(momentum.data.last_run) : null;
  const health: Health[] = [
    { name: "Token scanner", what: "Re-checks holders and trades every 10 minutes", ok: scanner.error ? null : !!lastScan && now - lastScan < 25 * 60_000, last: lastScan && lastScan > 0 ? lastScan : null,
      note: scanner.error ? "Not set up (analytics.sql)" : `Last run ${ago(lastScan && lastScan > 0 ? lastScan : null)} · ${scanner.data?.api_calls ?? 0} paid API calls today` },
    { name: "Trade sync", what: "Buys and sells for tokens people looked at this week", ok: tracked.count ? (traded1h.count ?? 0) > 0 : null, last: null,
      note: `${traded1h.count ?? 0} of ${tracked.count ?? 0} tokens synced in the last hour · ${checked1h.count ?? 0} balances re-checked` },
    { name: "Momentum", what: "Finds fast movers and sends alerts every 5 minutes", ok: momentum.error ? null : !!lastMom && now - lastMom < 15 * 60_000, last: lastMom && lastMom > 0 ? lastMom : null,
      note: momentum.error ? "Not set up" : `Last run ${ago(lastMom && lastMom > 0 ? lastMom : null)}` },
  ];
  if (!cron.error && Array.isArray(cron.data)) {
    for (const j of cron.data as { name: string; schedule: string; active: boolean; last_at: string | null; last_status: string | null; last_error: string | null; fails_24h: number }[]) {
      const last = j.last_at ? Date.parse(j.last_at) : null;
      health.push({
        name: `Scheduled job: ${j.name}`, what: `Runs ${j.schedule}`, last,
        ok: !j.active ? false : j.last_status === "failed" ? false : j.last_status ? true : null,
        note: !j.active ? "Turned off" : `${j.last_status ?? "not run yet"} ${ago(last)}${j.fails_24h ? ` · ${j.fails_24h} failed in 24 h` : ""}${j.last_status === "failed" && j.last_error ? ` · ${j.last_error}` : ""}`,
      });
    }
  }

  const pct2fa = a.total ? Math.round(((a.with_2fa || 0) / a.total) * 100) : 0;
  const wallets7 = wallets ? wallets.rows.filter((w) => now - w.at < 7 * DAY).length : null;
  const tiles = [
    { label: "Members", value: String(a.total ?? 0), sub: `+${a.joined_1d ?? 0} today · +${a.joined_7d ?? 0} this week` },
    { label: "Signed in", value: String(a.signed_1d ?? 0), sub: `last 24 h · ${a.signed_7d ?? 0} this week` },
    { label: "2-step on", value: `${a.with_2fa ?? 0}`, sub: `${pct2fa}% of members` },
    { label: "Wallets made", value: wallets ? `${wallets.total}${wallets.more ? "+" : ""}` : "–", sub: wallets7 == null ? "Privy not set up" : `+${wallets7} this week` },
    { label: "Swaps", value: String(swaps1.count ?? 0), sub: `last 24 h · ${swaps7.count ?? 0} this week` },
    { label: "Launches", value: String(launches7.count ?? 0), sub: `this week · ${liq7.count ?? 0} liquidity adds` },
  ];

  return {
    tiles, feed: feed.slice(0, 300), health, notes,
    launches: (launches.data || []).map((l: any) => ({
      at: Date.parse(l.created_at), chain: chainName(l.chain), symbol: l.symbol, name: l.name, source: l.source === "listed" ? "Listed" : "Launched here",
      lp: l.source === "listed" ? "–" : l.lp_lock === "burn" ? "LP burned" : l.lp_lock === "6m" ? "LP locked 6 months" : "LP locked 1 year",
      href: `/launchpad/${l.chain}/${l.token}`,
    })),
  };
}
