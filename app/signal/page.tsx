import { notFound } from "next/navigation";
import { adminState } from "@/lib/admin";
import Signal from "@/components/Signal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signal · AUTISTIK Hub", robots: { index: false, follow: false } };

/** Signal: the owner's private swap and bridge, routed through Bitget Wallet. Everyone else, admins included, gets a 404. */
export default async function SignalPage() {
  if (!(await adminState()).owner) notFound();
  return <Signal />;
}
