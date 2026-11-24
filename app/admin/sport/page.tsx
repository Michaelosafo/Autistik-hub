import { notFound } from "next/navigation";
import { adminState } from "@/lib/admin";
import SportBoard from "@/components/SportBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sport board · AUTISTIK Hub", robots: { index: false, follow: false } };

/** Owner only: football stats comparison and match predictions. Everyone else gets a 404. */
export default async function SportPage() {
  if (!(await adminState()).owner) notFound();
  return <SportBoard />;
}
