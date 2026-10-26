import ProHero from "@/components/ProHero";
import Guide from "@/components/Guide";
import SectionCards, { EARN_CARDS } from "@/components/SectionCards";
import SusuApp from "@/components/susu/SusuApp";
import { adminState } from "@/lib/admin";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Susu · AUTISTIK Hub",
  description: "Save USDT or BUSD every day on BNB Chain and get it all back at the end. Nobody can touch it before then.",
};

export default async function SusuPage() {
  const [{ admin }, user] = await Promise.all([adminState(), currentUser()]);
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <ProHero kicker="AUTISTIK Susu" title="Susu" tone="gold" />
      <SectionCards items={EARN_CARDS} active="/susu" label="Earn" />
      <Guide id="susu" title="How Susu works" tip="Your savings sit in a smart contract on BNB Chain. Nobody can take them out early, including AUTISTIK." steps={[
        "Pick USDT or BUSD, how much to save each day, and for how long (for example 30 days).",
        "Confirm in your wallet. Day 1 is saved straight away.",
        "Come back every day and press Save today. Missed a day? You can catch up.",
        "When the plan ends, press Withdraw and everything you saved comes back to your wallet in one go.",
      ]} />
      <SusuApp admin={admin} signedIn={!!user} />
    </div>
  );
}
