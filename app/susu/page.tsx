import EarnTop from "@/components/EarnTop";
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
    <div className="stack">
      <EarnTop active="/susu" title="Susu savings"
        text="Save a little every day in USDT or BUSD, and get it all back in one go at the end. Like a susu box, on the blockchain."
        steps={[
          { t: "Choose your plan", d: "USDT or BUSD, how much a day, and for how long: a week, a month, up to a year." },
          { t: "Save every day", d: "Day 1 is saved when you start. Come back daily and press Save today; we remind you." },
          { t: "Collect it all", d: "When the plan ends, press Withdraw and everything you saved comes back to your wallet." },
        ]}
        facts={[<><b>No fees</b>, only the small BNB network fee</>, <><b>Locked</b> until the end: nobody can take it early, not even AUTISTIK</>, <>Missed a day? You can <b>catch up</b></>, <>On <b>BNB Chain</b></>]}
      />
      <SusuApp admin={admin} signedIn={!!user} />
    </div>
  );
}
