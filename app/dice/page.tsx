import DiceGame from "@/components/DiceGame";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "AUTISTIK Dice · Play", description: "Put your chips in the pot, roll two dice, highest roll takes it all. Play chips only." };

export default async function DicePage() {
  const user = await currentUser();
  return <DiceGame signedIn={!!user} />;
}
