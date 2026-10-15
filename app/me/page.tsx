import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Your own profile.
export default async function Me() {
  const user = await currentUser();
  redirect(user ? `/members/${user.id}` : "/login?next=/me");
}
