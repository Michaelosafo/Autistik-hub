import RollDice from "@/components/RollDice";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roll the Dice · AUTISTIK Play", description: "Hold $10 of AUTISTIK, put $0.50 in the pot, roll two dice: highest roll takes it all. 18+." };

export default async function RollPage() {
  const user = await currentUser();
  return <RollDice signedIn={!!user} />;
}
