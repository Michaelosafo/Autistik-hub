"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

type Note = { id: number; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

const ago = (t: string) => {
  const m = (Date.now() - Date.parse(t)) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/**
 * Sell alerts for the tokens a member watches. Checks every minute while the page is open, and can also show
 * pop-ups on the device. `enabled` is false when nobody is signed in.
 */
export function useAlerts(enabled: boolean) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [popups, setPopups] = useState(false);
  const newest = useRef<number>(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data } = await supabaseBrowser().from("notifications").select("id,title,body,link,created_at,read_at").order("created_at", { ascending: false }).limit(25);
    const list = (data || []) as Note[];
    const top = list[0]?.id || 0;
    // Pop-up on the phone/computer for alerts that arrived since the last check.
    if (newest.current && top > newest.current && popups) {
      for (const n of list.filter((x) => x.id > newest.current && !x.read_at).slice(0, 3)) {
        try {
          const reg = await navigator.serviceWorker?.getRegistration();
          if (reg) reg.showNotification(n.title, { body: n.body || "", data: { link: n.link }, tag: "autistik-" + n.id });
          else new Notification(n.title, { body: n.body || "" });
        } catch {}
      }
    }
    newest.current = Math.max(newest.current, top);
    setNotes(list);
  }, [enabled, popups]);

  useEffect(() => {
    try { setPopups("Notification" in window && Notification.permission === "granted" && localStorage.getItem("alert-popups") === "1"); } catch {}
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible" || popups) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load, popups, enabled]);

  const markAll = useCallback(async () => {
    const ids = notes.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    setNotes((l) => l.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabaseBrowser().from("notifications").update({ read_at: now }).in("id", ids);
  }, [notes]);

  const enablePopups = useCallback(async () => {
    try {
      const p = await Notification.requestPermission();
      const on = p === "granted";
      setPopups(on); localStorage.setItem("alert-popups", on ? "1" : "0");
    } catch {}
  }, []);

  const canPopup = typeof window !== "undefined" && "Notification" in window;
  return { notes, unread: notes.filter((n) => !n.read_at).length, markAll, popups, canPopup, enablePopups };
}

/** The latest alerts, as a short list. */
export function AlertsList({ alerts, onPick }: { alerts: ReturnType<typeof useAlerts>; onPick: () => void }) {
  const { notes, popups, canPopup, enablePopups } = alerts;
  return (
    <div className="alerts-box">
      {!notes.length && <p className="muted" style={{ fontSize: ".86em" }}>No alerts yet. Watch a token on Stats to get told when its dev or top wallets sell.</p>}
      <div className="bell-list">
        {notes.slice(0, 6).map((n) => (
          <Link key={n.id} href={n.link || "/analytics"} className={"bell-item" + (n.read_at ? "" : " new")} onClick={onPick}>
            <b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{ago(n.created_at)}</small>
          </Link>
        ))}
      </div>
      {canPopup && !popups && <button className="btn small" type="button" onClick={enablePopups}>📲 Also show pop-ups on this device</button>}
    </div>
  );
}
