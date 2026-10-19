import WalletLoader from "@/components/wallet/WalletLoader";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Swap · AUTISTIK",
  description: "Swap any token on BNB Chain, Base, Ethereum, Arbitrum and Solana at the best price, from your own wallet.",
};

const clean = (v: string | undefined) => (v && /^[a-z0-9]{10,40}$/i.test(v.trim()) ? v.trim() : null);

export default function SwapPage({ searchParams }: { searchParams: { chain?: string; buy?: string } }) {
  const appId = clean(process.env.PRIVY_APP_ID) || clean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  return <WalletLoader appId={appId} start={{ chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64) }} app="swap" />;
}
