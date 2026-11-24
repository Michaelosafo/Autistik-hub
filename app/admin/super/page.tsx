import { notFound } from "next/navigation";
import { adminState } from "@/lib/admin";
import SuperBoard from "@/components/SuperBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Super · AUTISTIK Hub", robots: { index: false, follow: false } };

export default async function SuperPage() {
  if (!(await adminState()).owner) notFound();
  return <SuperBoard />;
}
