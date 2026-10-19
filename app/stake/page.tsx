import dynamicImport from "next/dynamic";
import ProHero from "@/components/ProHero";
import Guide from "@/components/Guide";
import SectionCards, { TOKEN_CARDS } from "@/components/SectionCards";
import WalletLoader from "@/components/wallet/WalletLoader";
import { adminState } from "@/lib/admin";

const StakeAdmin = dynamicImport(() => import("@/components/stake/StakeAdmin"), { ssr: false });

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stake · AUTISTIK Hub",
  description: "Stake $AUTISTIK and earn BNB from platform fees. Token teams can open staking pools for their own communities.",
};

const clean = (v: string | undefined) => (v && /^[a-z0-9]{10,40}$/i.test(v.trim()) ? v.trim() : null);

export default async function StakePage({ searchParams }: { searchParams: { pool?: string } }) {
  const appId = clean(process.env.PRIVY_APP_ID) || clean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const { admin } = await adminState();
  const pool = /^\d{1,6}$/.test(searchParams.pool || "") ? Number(searchParams.pool) : undefined;
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <ProHero kicker="AUTISTIK Staking" title="Stake" tone="gold" />
      <SectionCards items={TOKEN_CARDS} active="/stake" label="$AUTISTIK" />
      <Guide id="stake" title="How staking works" tip="Rewards come only from what each pool's team adds. APR changes as people join and leave." steps={[
        "Pick a pool. The Official pool: stake $AUTISTIK, earn BNB from the platform's trading fees.",
        "Tap Stake, type an amount and confirm twice in your wallet (allow, then stake).",
        "Rewards build up every second. Tap Collect any time. Withdraw when your lock ends.",
        "Token teams: open Create a pool, add rewards, and share the link with your holders.",
      ]} />
      <WalletLoader appId={appId} start={{ pool, admin }} app="stake" />
      {admin && <StakeAdmin />}
    </div>
  );
}
