"use client";
import Avatar from "@/components/Avatar";

/**
 * Your picture (or the AUTISTIK logo until you add a photo). Opens your panel, where you can add or change your
 * photo: components/Shell.tsx listens for the "me-panel" event. Used on the front page, with "My Profile" written under it.
 */
export default function MeButton({ alias, avatarUrl, label }: { alias: string; avatarUrl: string | null; label?: string }) {
  return (
    <button type="button" className={"me-pic" + (label ? " labelled" : "")} aria-haspopup="dialog" aria-label={label || (avatarUrl ? "Your panel" : "Your panel: add a photo")}
      onClick={() => window.dispatchEvent(new Event("me-panel"))}>
      <span className="me-pic-img">
        <Avatar className="me-av" alias={alias} url={avatarUrl} logo />
        {!avatarUrl && <span className="me-pic-add" aria-hidden="true">+</span>}
      </span>
      {label && <span className="me-pic-l" aria-hidden="true">{label}</span>}
    </button>
  );
}
