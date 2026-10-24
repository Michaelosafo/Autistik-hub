"use client";
import Avatar from "@/components/Avatar";

/**
 * Your picture (or the AUTISTIK logo until you add a photo). Opens your panel, where you can add or change your
 * photo: components/Shell.tsx listens for the "me-panel" event. Used on the front page.
 */
export default function MeButton({ alias, avatarUrl }: { alias: string; avatarUrl: string | null }) {
  return (
    <button type="button" className="me-pic" aria-haspopup="dialog" aria-label={avatarUrl ? "Your panel" : "Your panel: add a photo"}
      onClick={() => window.dispatchEvent(new Event("me-panel"))}>
      <Avatar className="me-av" alias={alias} url={avatarUrl} logo />
      {!avatarUrl && <span className="me-pic-add" aria-hidden="true">+</span>}
    </button>
  );
}
