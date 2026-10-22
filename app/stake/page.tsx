import dynamicImport from "next/dynamic";
import ProHero from "@/components/ProHero";
import Guide from "@/components/Guide";
import SectionCards, { EARN_CARDS } from "@/components/SectionCards";
import WalletLoader from "@/components/wallet/WalletLoader";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";
import { adminState } from "@/lib/admin";

const StakeAdmin = dynamicImport(() => import("@/components/stake/StakeAdmin"), { ssr: false });

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Stake · AUTISTIK Hub",
  description: "Stake $AUTISTIK and earn BNB from platform fees. Token teams can open staking pools for their own communities.",
};

export default async function StakePage({ searchParams }: { searchParams: { pool?: string } }) {
  // Privy's app ID is public (it only names the app). Read at request time so adding it in Vercel needs no code change.
  const appId = PRIVY_APP_ID;
  const member = appId ? await walletMember() : null;
  const { admin } = await adminState();
  const pool = /^\d{1,6}$/.test(searchParams.pool || "") ? Number(searchParams.pool) : undefined;
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <ProHero kicker="AUTISTIK Staking" title="Stake" tone="gold" />
      <SectionCards items={EARN_CARDS} active="/stake" label="Earn" />
      <Guide id="stake" title="How staking works" tip="Rewards come only from what each pool's team adds. APR changes as people join and leave." steps={[
        "Pick a pool. The Official pool: stake $AUTISTIK, earn BNB from the platform's trading fees.",
        "Tap Stake, type an amount and confirm twice in your wallet (allow, then stake).",
        "Rewards build up every second. Tap Collect any time. Withdraw when your lock ends.",
        "Token teams: open Create a pool, add rewards, and share the link with your holders.",
      ]} />
      <WalletLoader appId={appId} member={member} start={{ pool, admin }} app="stake" />
      {admin && <StakeAdmin />}
    </div>
  );
}
