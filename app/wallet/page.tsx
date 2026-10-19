import dynamicImport from "next/dynamic";
import WalletLoader from "@/components/wallet/WalletLoader";
import { adminState } from "@/lib/admin";

const OrdersAdmin = dynamicImport(() => import("@/components/wallet/OrdersAdmin"), { ssr: false });

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wallet · AUTISTIK Hub",
  description: "Your own self-custody crypto wallet: buy, sell and swap any token on BNB Chain, Base, Ethereum, Arbitrum and Solana.",
};

const clean = (v: string | undefined) => (v && /^[a-z0-9]{10,40}$/i.test(v.trim()) ? v.trim() : null);

export default async function WalletPage({ searchParams }: { searchParams: { chain?: string; buy?: string } }) {
  // Privy's app ID is public (it only names the app). Read at request time so adding it in Vercel needs no code change.
  const appId = clean(process.env.PRIVY_APP_ID) || clean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const { admin } = await adminState();
  const start = { chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64) };
  return (
    <div className="stack" style={{ maxWidth: 1320 }}>
      <h1 className="sr-only">AUTISTIK Wallet</h1>
      <WalletLoader appId={appId} start={start} />
      {admin && <OrdersAdmin />}
      <p className="muted" style={{ fontSize: ".82em" }}>
        Self-custody: your keys, your coins. Swaps use KyberSwap (BNB Chain, Base, Ethereum, Arbitrum) and Jupiter (Solana) to find the best price across every DEX.
        A 0.5% fee per trade supports the AUTISTIK team. Limit and stop-loss orders fill automatically through the AUTISTIK Orders contract; your tokens stay in your wallet until then. Tokens can lose all their value; nothing here is financial advice.
      </p>
    </div>
  );
}
