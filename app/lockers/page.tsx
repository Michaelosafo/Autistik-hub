import Link from "next/link";
import { getAddress, isAddress } from "viem";
import SectionCards, { LAUNCH_CARDS } from "@/components/SectionCards";
import Locker from "@/components/Locker";
import LockerDeploy from "@/components/LockerDeploy";
import LockCard from "@/components/LockCard";
import ProHero from "@/components/ProHero";
import { adminState } from "@/lib/admin";
import { supabaseService } from "@/lib/supabase/server";
import { LOCKER_CHAINS, isLockerChain, short, untilText } from "@/lib/locker";
import { locksFor, lockerSites, lpLockLive, recentLocks } from "@/lib/locker-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lockers · AUTISTIK Hub", description: "Lock liquidity or tokens, and check any token's locks." };

const amt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) < 1 ? 6 : 0 });

export default async function LockersPage({ searchParams }: { searchParams: { chain?: string; token?: string } }) {
  const [sites, { admin }] = await Promise.all([lockerSites(), adminState()]);
  const qChain = isLockerChain(searchParams.chain) ? searchParams.chain : "bsc";
  const qToken = searchParams.token && isAddress(searchParams.token.trim()) ? getAddress(searchParams.token.trim()) : null;
  const [recent, check] = await Promise.all([
    recentLocks().catch(() => []),
    qToken ? (async () => {
      const { data: t } = await supabaseService().from("tracked_tokens").select("symbol,pair").eq("chain", qChain).eq("token", qToken).maybeSingle();
      const [lp, locks] = await Promise.all([lpLockLive(qChain, qToken), locksFor(qChain, qToken, t?.pair)]);
      return { lp, locks, symbol: t?.symbol as string | undefined };
    })() : Promise.resolve(null),
  ]);

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <SectionCards items={LAUNCH_CARDS} active="/lockers" label="Launch" />
      <ProHero tone="green" kicker="AUTISTIK · LOCKER" title="🔒 Lock liquidity &amp; tokens" live={sites.length ? "Live" : false}
        text={<>Lock your pool&apos;s liquidity so it can&apos;t be pulled (no rug pull), or lock team tokens so they can&apos;t be dumped. Nobody, not even the AUTISTIK team, can touch a lock before its date.</>}
        stats={[[sites.length || "Soon", "networks live"], [recent.length, "recent locks"], ["Verified", "open-source code"], ["No", "early unlock"]]} />

      {sites.length ? <Locker sites={sites} /> : (
        <div className="notice warn">🔒 The AUTISTIK Locker opens very soon. You can already check any token&apos;s locks below.</div>
      )}
      {admin && <LockerDeploy sites={sites} />}

      <div className="card stack" style={{ gap: 10 }}>
        <h2 style={{ margin: 0 }}>🔎 Check a token&apos;s locks</h2>
        <form className="row" style={{ gap: 8, flexWrap: "wrap" }} action="/lockers">
          <select name="chain" defaultValue={qChain} aria-label="Chain">
            {Object.entries(LOCKER_CHAINS).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
          </select>
          <input name="token" defaultValue={qToken ?? ""} placeholder="Token or LP address 0x…" style={{ flex: 1, minWidth: 200 }} spellCheck={false} />
          <button className="btn primary" type="submit">Check</button>
        </form>
        {searchParams.token && !qToken && <div className="notice warn">That isn&apos;t a valid address.</div>}
        {qToken && check && (
          <>
            <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <b>{check.symbol ? `$${check.symbol}` : short(qToken)} on {LOCKER_CHAINS[qChain].name}</b>
              <Link href={`/analytics/${qChain}/${qToken}`}>📊 Full analysis →</Link>
            </div>
            <LockCard lp={check.lp} locks={check.locks} chain={qChain} token={qToken} lockerLive={sites.length > 0} />
          </>
        )}
      </div>

      {recent.length > 0 && (
        <div className="card stack" style={{ gap: 8 }}>
          <h2 style={{ margin: 0 }}>🆕 Latest locks</h2>
          {recent.slice(0, 20).map((l) => (
            <Link key={`${l.chain}-${l.id}`} href={`/lockers?chain=${l.chain}&token=${l.token}`} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", color: "inherit", textDecoration: "none" }}>
              <span>{l.isLp ? "💧" : "🪙"} <b>{amt(l.amount)} {l.name}</b>{l.description ? <span className="muted"> · {l.description.slice(0, 60)}</span> : null}</span>
              <span className="muted">{LOCKER_CHAINS[l.chain].name} · {l.done ? "unlocked" : l.unlockDate * 1000 > Date.now() ? `🔒 ${untilText(l.unlockDate)}` : "unlockable"}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="card stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>How it works</h2>
        <ol className="stack" style={{ gap: 6, paddingLeft: 20, margin: 0 }}>
          <li><b>Pick what to lock:</b> liquidity (your pool&apos;s LP token, found as the &quot;Pair&quot; on DexScreener) or tokens.</li>
          <li><b>Pick how much and until when:</b> 1 month to years, or unlock in monthly steps (vesting).</li>
          <li><b>Confirm twice in your wallet:</b> once to allow the locker, once to lock.</li>
          <li><b>Share it:</b> the lock shows here, on the token&apos;s analysis page and on the explorer, so buyers can see it.</li>
        </ol>
        <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>
          The locker is open source and has no owner, admin or fees. DexScreener&apos;s safety panel and scanners like GoPlus list locks from lockers they know; new lockers are added to their lists over time. If you need a badge everywhere instantly, burning liquidity always shows.
        </p>
      </div>
      {admin && (
        <details className="card">
          <summary><b>🛠️ Admin: getting the locker recognised by scanners</b></summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <p className="muted" style={{ margin: 0 }}>After the locker is deployed and verified, send this to GoPlus (support / business contact on gopluslabs.io) and DexScreener (support form on dexscreener.com). Copy and paste:</p>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: ".85em", margin: 0 }}>{`Hello, we run AUTISTIK Hub (https://autistik.io) and launched an open-source token & liquidity locker. Please add it to your recognised lockers so locked LP/tokens show as locked.

${sites.map((s) => `${LOCKER_CHAINS[s.chain].name}: ${s.address}`).join("\n") || "(deployed addresses appear here)"}

- Verified source, no owner/admin/fees, no upgrades.
- Same layout, function names and events as PinkLock V2 (lock, vestingLock, unlock, editLock, getLockById, getLocks, lockIdsForToken, totalLockedForToken; events LockAdded, LockUpdated, LockRemoved, LockVested, LockOwnerChanged).
- Unlock date per lock: getLockById(id).tgeDate.

Thank you!`}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
