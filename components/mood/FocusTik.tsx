"use client";
import { useRouter } from "next/navigation";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";

/** One Tik on its own page, like a post on X: back arrow, the post large, its numbers, then the comments. */
export default function FocusTik({ id }: { id: string }) {
  const router = useRouter();
  const { tiks, me } = useTiks({ only: id, limit: 1 });
  const back = () => (window.history.length > 1 ? router.back() : router.push("/mood"));
  return (
    <div className="tik-post-page">
      <div className="tik-post-bar">
        <button type="button" onClick={back} aria-label="Back to TIK">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
        </button>
        <b>Post</b>
      </div>
      {tiks === null ? <small className="muted">Loading…</small> : !tiks.length ? <small className="muted">This Tik isn&apos;t there any more.</small> : <TikCard t={tiks[0]} me={me} detail />}
    </div>
  );
}
