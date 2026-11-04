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
  return <WalletLoader appId={appId} member={member} start={start} app="wallet" />;
}
