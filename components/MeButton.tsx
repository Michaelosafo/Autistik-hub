"use client";
/** Opens your panel (components/Shell.tsx listens for the "me-panel" event). Used on the front page. */
export default function MeButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("me-panel"))}>
      {children}
    </button>
  );
}
