/** Turns on alerts that reach this phone or computer even when the site is closed. Browser only. */
const toBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export const canPush = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;

/**
 * Asks permission and signs this device up. Returns "push" when alerts will arrive even with the site closed,
 * "local" when only pop-ups while the site is open are possible, or "denied".
 */
export async function enablePush(): Promise<"push" | "local" | "denied"> {
  if (!("Notification" in window)) return "denied";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  try { localStorage.setItem("alert-popups", "1"); } catch {}
  if (!canPush()) return "local";
  try {
    const { key } = await fetch("/api/push").then((r) => r.json());
    if (!key) return "local";
    const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }));
    const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    return r.ok ? "push" : "local";
  } catch { return "local"; }
}

/** True when this device is already signed up for push alerts. */
export async function hasPush() {
  if (!canPush() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  return !!(await reg?.pushManager.getSubscription().catch(() => null));
}
