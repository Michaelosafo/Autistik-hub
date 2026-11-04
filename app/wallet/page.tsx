import Link from "next/link";
import WalletLoader from "@/components/wallet/WalletLoader";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My wallet · AUTISTIK",
  description: "Your balances on every network, your transaction history, and send and receive, from your own wallet.",
};

/** Just the wallet: assets, history (transactions), send, receive and security. Opened from Trade → My wallet. */
export default async function WalletPage({ searchParams }: { searchParams: { chain?: string; buy?: string; quick?: string } }) {
  const appId = PRIVY_APP_ID;
  const member = appId ? await walletMember() : null;
  const start = { chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64), quick: searchParams.quick === "1" };
  return (
    <div className="stack">
      <WalletLoader appId={appId} member={member} start={start} app="wallet" />
      <div className="card row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div><b>Offline swap</b><p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Swap face to face with QR codes, even with no internet. It settles when one of you is back online.</p></div>
        <Link className="btn" href="/wallet/offline">Open offline swap</Link>
      </div>
    </div>
  );
}
