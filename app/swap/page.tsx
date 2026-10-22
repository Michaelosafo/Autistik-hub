import WalletLoader from "@/components/wallet/WalletLoader";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Swap · AUTISTIK",
  description: "Swap any token on BNB Chain, Base, Ethereum, Arbitrum and Solana at the best price, from your own wallet.",
};

export default async function SwapPage({ searchParams }: { searchParams: { chain?: string; buy?: string } }) {
  // Privy's app ID is public (it only names the app). Read at request time so adding it in Vercel needs no code change.
  const appId = PRIVY_APP_ID;
  const member = appId ? await walletMember() : null;
  return <WalletLoader appId={appId} member={member} start={{ chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64) }} app="swap" />;
}
