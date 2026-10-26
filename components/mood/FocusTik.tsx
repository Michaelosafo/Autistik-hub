"use client";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";

/** The Tik a notification points to, shown first on the page. */
export default function FocusTik({ id }: { id: string }) {
  const { tiks, me } = useTiks({ only: id, limit: 1 });
  if (!tiks?.length) return null;
  return <div className="tik-focus"><small className="mp-cap">From your notification</small><TikCard t={tiks[0]} me={me} /></div>;
}
