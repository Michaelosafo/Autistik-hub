import dynamicImport from "next/dynamic";
import EarnTop from "@/components/EarnTop";
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
    <div className="stack earn">
      <EarnTop active="/stake" title="Stake & earn"
        text="Put your tokens to work. Stake $AUTISTIK and earn BNB from the fees people pay on AUTISTIK."
        steps={[
          { t: "Pick a pool", d: "The Official pool: stake $AUTISTIK, earn BNB from platform fees. Token teams run their own pools too." },
          { t: "Stake", d: "Type an amount and confirm twice in your wallet: allow, then stake." },
          { t: "Collect any time", d: "Rewards build up every second. Withdraw when your lock ends." },
        ]}
        facts={[<><b>BNB</b> rewards from platform fees</>, <>Lock longer for up to <b>3x</b></>, <>Your tokens stay <b>yours</b>: nobody else can move them</>, <>Rewards come only from what each pool&apos;s team adds; APR moves as people join and leave</>]}
      />
      <WalletLoader appId={appId} member={member} start={{ pool, admin }} app="stake" />
      {admin && <StakeAdmin />}
    </div>
  );
}
