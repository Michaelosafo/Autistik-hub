"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Opens the shared Tik in TIK straight away. */
export default function OpenTik({ id, who }: { id: string; who: string }) {
  const router = useRouter();
  const href = id ? `/mood?tik=${id}` : "/mood";
  useEffect(() => { router.replace(href); }, [href, router]);
  return <div className="card stack" style={{ maxWidth: 520, margin: "40px auto" }}><b>Opening {who}&apos;s Tik…</b><Link href={href}>Open it in TIK →</Link></div>;
}
