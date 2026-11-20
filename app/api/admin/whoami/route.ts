import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** For the admin menu: is the signed-in user the owner (owner-only groups) and an admin at all. */
export async function GET() {
  const { owner, helper, staff } = await adminState();
  return json({ owner, admin: owner || helper, staff });
}
