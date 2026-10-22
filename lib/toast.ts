/**
 * Small pop-up notes ("Swap done") shown at the top of the screen, from anywhere in the browser code.
 * `<Toaster />` (in the site frame) shows them. When the tab is in the background and the member already allowed
 * notifications, the note also comes as a phone / computer notification.
 */
export type Toast = { id: number; kind: "ok" | "bad" | "info"; title: string; text?: string; link?: { href: string; label: string } };

let seq = 0;

export function toast(t: Omit<Toast, "id">) {
  if (typeof window === "undefined") return;
  const full: Toast = { ...t, id: ++seq };
  try { window.dispatchEvent(new CustomEvent("aw-toast", { detail: full })); } catch { /* old browsers */ }
  try {
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification(t.title, { body: t.text, icon: "/icon.svg", tag: `aw-toast-${full.id}` });
    }
  } catch { /* some phones only allow notifications from a service worker */ }
  try { navigator.vibrate?.(t.kind === "bad" ? [80, 60, 80] : 60); } catch { /* not supported */ }
}
