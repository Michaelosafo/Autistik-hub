import WalletLoader from "@/components/wallet/WalletLoader";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wallet · AUTISTIK Hub",
  description: "Your own self-custody crypto wallet: buy, sell and swap any token on BNB Chain, Base, Ethereum, Arbitrum and Solana.",
};

const clean = (v: string | undefined) => (v && /^[a-z0-9]{10,40}$/i.test(v.trim()) ? v.trim() : null);

export default function WalletPage({ searchParams }: { searchParams: { chain?: string; buy?: string } }) {
  // Privy's app ID is public (it only names the app). Read at request time so adding it in Vercel needs no code change.
  const appId = clean(process.env.PRIVY_APP_ID) || clean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const start = { chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64) };
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <h1 className="sr-only">AUTISTIK Wallet</h1>
      <WalletLoader appId={appId} start={start} />
      <p className="muted" style={{ fontSize: ".82em" }}>
        Self-custody: your keys, your coins. Swaps use KyberSwap (BNB Chain, Base, Ethereum, Arbitrum) and Jupiter (Solana) to find the best price across every DEX.
        A 0.5% fee per swap supports the AUTISTIK team. Tokens can lose all their value; nothing here is financial advice.
      </p>
    </div>
  );
}
