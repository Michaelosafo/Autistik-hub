"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

type Note = { id: number; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

const ago = (t: string) => {
  const m = (Date.now() - Date.parse(t)) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** 🔔 Sell alerts for the tokens a member watches. Checks every minute; can also show phone pop-ups while the site is open. */
export default function NotificationBell() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [popups, setPopups] = useState(false);
  const newest = useRef<number>(0);
  const wrap = useRef<HTMLDivElement>(null);
  const unread = notes.filter((n) => !n.read_at).length;

  const load = useCallback(async () => {
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
  }, [popups]);

  useEffect(() => {
    try { setPopups("Notification" in window && Notification.permission === "granted" && localStorage.getItem("alert-popups") === "1"); } catch {}
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible" || popups) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load, popups]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function markAll() {
    const ids = notes.filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    const now = new Date().toISOString();
    setNotes((l) => l.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    await supabaseBrowser().from("notifications").update({ read_at: now }).in("id", ids);
  }
  async function enablePopups() {
    try {
      const p = await Notification.requestPermission();
      const on = p === "granted";
      setPopups(on); localStorage.setItem("alert-popups", on ? "1" : "0");
    } catch {}
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button className="tool bell" type="button" aria-expanded={open} aria-label={`Alerts${unread ? `, ${unread} new` : ""}`} title="Sell alerts" onClick={() => { setOpen(!open); if (!open) setTimeout(markAll, 1500); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="bell-n">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Alerts">
          <div className="row" style={{ justifyContent: "space-between" }}><b>🔔 Alerts</b><Link href="/analytics" onClick={() => setOpen(false)} style={{ fontSize: ".82em" }}>Analytics →</Link></div>
          {!notes.length && <p className="muted" style={{ fontSize: ".86em" }}>No alerts yet. Watch a token on Analytics to get told when its dev or top wallets sell.</p>}
          <div className="bell-list">
            {notes.map((n) => (
              <Link key={n.id} href={n.link || "/analytics"} className={"bell-item" + (n.read_at ? "" : " new")} onClick={() => setOpen(false)}>
                <b>{n.title}</b>{n.body && <span>{n.body}</span>}<small>{ago(n.created_at)}</small>
              </Link>
            ))}
          </div>
          {"Notification" in (typeof window !== "undefined" ? window : {}) && !popups && (
            <button className="btn small" type="button" onClick={enablePopups}>📲 Also show pop-ups on this device</button>
          )}
        </div>
      )}
    </div>
  );
}
