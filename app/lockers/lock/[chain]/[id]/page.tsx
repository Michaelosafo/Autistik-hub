import Link from "next/link";
import { notFound } from "next/navigation";
import CopyShare from "@/components/CopyShare";
import { LOCKER_CHAINS, isLockerChain, short, untilText } from "@/lib/locker";
import { lockById } from "@/lib/locker-server";

export const revalidate = 120;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/+$/, "");
const amt = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) < 1 ? 6 : 0 });
const day = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export async function generateMetadata({ params }: { params: { chain: string; id: string } }) {
  if (!isLockerChain(params.chain)) return {};
  const l = await lockById(params.chain, Number(params.id));
  if (!l) return { title: "Lock not found · AUTISTIK Locker" };
  const title = `🔒 ${amt(l.left)} ${l.name} locked ${l.done ? "(released)" : `until ${day(l.unlockDate)}`}`;
  const description = `${l.pctOfSupply !== null ? `${l.pctOfSupply.toFixed(2)}% of the supply. ` : ""}Read live from ${LOCKER_CHAINS[params.chain].name}. Nobody can unlock it early, not even AUTISTIK.`;
  return { title: `${title} · AUTISTIK Locker`, description, openGraph: { title, description } };
}

export default async function LockCertificate({ params }: { params: { chain: string; id: string } }) {
  if (!isLockerChain(params.chain) || !/^\d{1,9}$/.test(params.id)) notFound();
  const l = await lockById(params.chain, Number(params.id));
  if (!l) notFound();
  const c = LOCKER_CHAINS[params.chain];
  const url = `${SITE}/lockers/lock/${params.chain}/${params.id}`;
  const badge = `${SITE}/api/lockers/badge?chain=${params.chain}&id=${params.id}`;
  const now = Date.now() / 1000;
  const status = l.done ? "Released" : l.unlockDate > now ? "Locked" : "Unlockable";
  const span = Math.max(1, l.unlockDate - l.lockDate);
  const progress = Math.min(100, Math.max(0, ((now - l.lockDate) / span) * 100));
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className={"card stack lock-cert" + (status === "Locked" ? " on" : "")} style={{ gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <small className="muted">AUTISTIK LOCKER · CERTIFICATE #{l.id} · {c.name}</small>
          <span className={"badge" + (status === "Locked" ? " v" : "")}>{status === "Locked" ? "🔒 Locked" : status === "Released" ? "✅ Released" : "⏰ Unlockable"}</span>
        </div>
        <h1 style={{ margin: 0, fontSize: "1.6em" }}>{amt(l.left)} {l.name}</h1>
        {l.pctOfSupply !== null && <p style={{ margin: 0, fontSize: "1.15em" }}><b>{l.pctOfSupply.toFixed(2)}%</b> of all {l.isLp ? "liquidity" : "tokens"} {status === "Released" ? "was" : "is"} locked here</p>}
        {!l.done && <>
          <div className="lock-bar" aria-label={`${progress.toFixed(0)}% of the lock time has passed`}><span style={{ width: `${progress}%` }} /></div>
          <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <small className="muted">Locked {day(l.lockDate)}</small>
            <small><b>{l.vesting ? "Releases step by step from" : "Unlocks"} {day(l.unlockDate)}</b> ({untilText(l.unlockDate)})</small>
          </div>
        </>}
        {l.vesting && <small className="muted">Vesting: {(l.tgeBps / 100).toFixed(2)}% at the first date, then {(l.cycleBps / 100).toFixed(2)}% every {Math.round(l.cycleDays)} days.</small>}
        {l.description && <p className="muted" style={{ margin: 0 }}>&ldquo;{l.description}&rdquo;</p>}
        <div className="cert-facts">
          <div><small className="muted">{l.isLp ? "Liquidity (LP) token" : "Token"}</small><a className="mono" href={`${c.explorer}/token/${l.token}`} target="_blank" rel="noopener noreferrer">{short(l.token)}</a></div>
          <div><small className="muted">Lock owner</small><a className="mono" href={`${c.explorer}/address/${l.owner}`} target="_blank" rel="noopener noreferrer">{short(l.owner)}</a></div>
          <div><small className="muted">Held by the locker</small><a className="mono" href={`${c.explorer}/address/${l.locker}#code`} target="_blank" rel="noopener noreferrer">{short(l.locker)}</a></div>
          <div><small className="muted">Read</small><span>live from {c.name}</span></div>
        </div>
        <ul className="lc-facts" style={{ margin: 0 }}>
          <li>Nobody can unlock this early: not the owner, not AUTISTIK. The locker has no owner or admin.</li>
          <li>When it ends, the tokens can only go to the lock owner&apos;s wallet.</li>
          <li>Check it yourself: on the explorer, open the locker&apos;s <b>Read Contract</b>, pick <code>getLockById</code> and enter <b>{l.id}</b>.</li>
        </ul>
        <img src={badge} alt={`Lock badge: ${l.name} locked`} width={420} height={84} style={{ maxWidth: "100%", height: "auto" }} />
        <CopyShare url={url} text={`🔒 ${amt(l.left)} ${l.name} locked ${l.done ? "" : `until ${day(l.unlockDate)}`} on the AUTISTIK Locker. Check it live:`}
          snippet={`<a href="${url}"><img src="${badge}" alt="Locked on AUTISTIK Locker" width="420" height="84"></a>`} />
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <Link href="/lockers/trust">🛡️ Why the AUTISTIK Locker is safe</Link>
        <Link href={`/lockers?chain=${params.chain}&token=${l.token}`}>All locks for this token</Link>
        <Link href="/lockers#lock">Lock your own tokens</Link>
      </div>
    </div>
  );
}
