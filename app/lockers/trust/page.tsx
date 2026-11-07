import Link from "next/link";
import ProHero from "@/components/ProHero";
import { LockTabs } from "@/components/EarnTop";
import { LOCKER_CHAINS, short } from "@/lib/locker";
import { lockerTrust } from "@/lib/locker-server";

export const revalidate = 600;
export const metadata = {
  title: "Is the AUTISTIK Locker safe? Live proof · AUTISTIK Hub",
  description: "Live on-chain checks anyone can repeat: open-source, no owner, no admin, not upgradeable. Nobody can touch a lock before its date.",
};

const SOURCE = "https://github.com/Michaelosafo/Autistik-hub/blob/main/contracts/AutistikLocker.sol";
const mark = (v: boolean | null) => (v === null ? "…" : v ? "✅" : "⚠️");

export default async function LockerTrustPage() {
  const checks = await lockerTrust().catch(() => []);
  const total = checks.reduce((n, c) => n + (c.locks || 0), 0);
  const allGood = checks.length > 0 && checks.every((c) => c.noOwner && c.noAdmin && c.notUpgradeable);
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <LockTabs active="/lockers" />
      <ProHero tone="green" kicker="AUTISTIK · LOCKER · PROOF" title="Don&apos;t trust us. Check it yourself."
        live={allGood ? "All checks pass" : false}
        text={<>The locker is a smart contract, not a company holding your coins. Below, this page reads every locker straight from the blockchain right now. Anyone can repeat each check on BscScan or Etherscan in a minute.</>}
        stats={[[checks.length || "…", "networks"], [total.toLocaleString("en-US"), "locks held"], ["0", "owners or admins"], ["Open", "source code"]]} />

      <div className="trust-grid">
        <div className="trust-tile"><span>🔓❌</span><b>No early unlock</b><small>Not for you, not for us. The code has no function that moves a lock before its date.</small></div>
        <div className="trust-tile"><span>👑❌</span><b>No owner, no admin</b><small>Nobody holds keys over the locker. Asking it &quot;who is the owner?&quot; fails, because there isn&apos;t one.</small></div>
        <div className="trust-tile"><span>🧱</span><b>Can&apos;t be changed</b><small>Not an upgradeable proxy: the code you read today is the code forever.</small></div>
        <div className="trust-tile"><span>🎯</span><b>Pays only the owner</b><small>When a lock ends, tokens can only go to the lock&apos;s owner, never to whoever presses the button.</small></div>
        <div className="trust-tile"><span>💸</span><b>No fees, no tax</b><small>The locker takes nothing from your tokens.</small></div>
        <div className="trust-tile"><span>📖</span><b>Open source</b><small>Verified on the explorer and public on GitHub, using the same layout as PinkLock V2.</small></div>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <h2 style={{ margin: 0 }}>Live checks, read from the chain just now</h2>
        {checks.length === 0 && <p className="muted" style={{ margin: 0 }}>Couldn&apos;t reach the networks just now. Reload in a minute.</p>}
        <div className="trust-table" role="table">
          <div className="trust-row head" role="row"><span>Network</span><span>Contract</span><span>Owner</span><span>Admin</span><span>Upgradeable</span><span>Code</span><span>Locks</span></div>
          {checks.map((c) => (
            <div key={c.chain} className="trust-row" role="row">
              <span><b>{LOCKER_CHAINS[c.chain].name}</b></span>
              <span><a className="mono" href={`${c.explorer}/address/${c.address}#code`} target="_blank" rel="noopener noreferrer">{short(c.address)}</a></span>
              <span title="Calling owner() fails: the contract has none">{mark(c.noOwner)} {c.noOwner ? "none" : c.noOwner === false ? "has one" : ""}</span>
              <span title="Calling admin() fails: the contract has none">{mark(c.noAdmin)} {c.noAdmin ? "none" : c.noAdmin === false ? "has one" : ""}</span>
              <span title="The EIP-1967 proxy slot is empty">{mark(c.notUpgradeable)} {c.notUpgradeable ? "no" : c.notUpgradeable === false ? "yes" : ""}</span>
              <span>{c.verified ? <a href={`${c.explorer}/address/${c.address}#code`} target="_blank" rel="noopener noreferrer">✅ verified</a> : <a href={SOURCE} target="_blank" rel="noopener noreferrer">📖 on GitHub</a>}</span>
              <span>{c.locks === null ? "…" : c.locks.toLocaleString("en-US")}</span>
            </div>
          ))}
        </div>
        <small className="muted">Rechecked every 10 minutes. &quot;None&quot; means the contract was asked for an owner or admin and has no such thing.</small>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Repeat it yourself in 1 minute</h2>
        <ol className="stack" style={{ gap: 6, paddingLeft: 20, margin: 0 }}>
          <li>Open a locker address above. On the explorer, the <b>Contract</b> tab shows a green tick: the published code matches what&apos;s running.</li>
          <li>Open <b>Read Contract</b>. There is no <code>owner</code>, no <code>admin</code>, no <code>withdraw</code>, no <code>pause</code>, nothing to upgrade.</li>
          <li>Pick <code>getLockById</code>, enter a lock number, and see the token, amount, owner and unlock date (<code>tgeDate</code>), straight from the chain.</li>
          <li>Search the code for how tokens leave: one place, <code>_release</code>, which only pays <code>l.owner</code>, and only what&apos;s due.</li>
        </ol>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <a className="btn small" href={SOURCE} target="_blank" rel="noopener noreferrer">📖 Read the source code</a>
          <Link className="btn small primary" href="/lockers#lock">🔒 Lock with confidence</Link>
        </div>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Show your lock anywhere</h2>
        <p className="muted" style={{ margin: 0 }}>Every lock has its own certificate page, read live from the chain, and a badge image you can post in your Telegram, on X or on your website. Buyers click it and see the proof themselves, even before scanners list our locker.</p>
        <p className="muted" style={{ margin: 0 }}>Find your lock under <Link href="/lockers">Check a token&apos;s locks</Link> and press <b>Certificate</b>.</p>
      </div>

      <div className="card stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Why some scanners don&apos;t show it yet</h2>
        <p className="muted" style={{ margin: 0 }}>Scanners like DexScreener and GoPlus only show locks from lockers on their own lists, and they add new lockers by hand. Ours has been sent to them, with its addresses on every network. Until they add it, this page and your lock&apos;s certificate are the proof. Burned liquidity shows on every scanner straight away.</p>
      </div>
    </div>
  );
}
