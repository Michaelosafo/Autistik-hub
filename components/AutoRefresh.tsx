"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the page's data every `seconds` while it's open on screen, so live trades keep appearing. */
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
