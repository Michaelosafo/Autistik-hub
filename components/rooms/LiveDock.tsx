"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import LiveRoom, { forgetLive, rememberedLive, type LiveMe, type LiveRoomInfo } from "./LiveRoom";
import { supabaseBrowser } from "@/lib/supabase/client";

type Dock = { attach: (room: LiveRoomInfo, me: LiveMe, el: HTMLElement) => void; detach: (roomId: string) => void };
const Ctx = createContext<Dock | null>(null);

/**
 * Keeps a live running while you use the rest of the site. The room is drawn once, here in the layout, and moved into
 * the live's page while you're on it, or into a small player at the bottom of the screen when you go elsewhere.
 * The voices, your mic and the recording never stop until you tap Leave or the host ends it.
 * After closing the site, coming back shows a "Back to the live" button (and the live's page rejoins on its own).
 */
export default function LiveDock({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [cur, setCur] = useState<{ room: LiveRoomInfo; me: LiveMe; auto: boolean } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [st, setSt] = useState({ joined: false, ended: false });
  const [back, setBack] = useState<{ id: string; title: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const host = useRef<HTMLDivElement | null>(null);
  const mini = useRef<HTMLDivElement>(null);
  const stRef = useRef(st);
  stRef.current = st;

  useEffect(() => {
    host.current = document.createElement("div");
    host.current.className = "lv-host";
    setMounted(true);
  }, []);

  const attach = useCallback((room: LiveRoomInfo, me: LiveMe, el: HTMLElement) => {
    setCur((c) => (c && c.room.id === room.id ? c : { room, me, auto: rememberedLive()?.id === room.id }));
    setSlot(el);
    setBack(null);
  }, []);
  const detach = useCallback((roomId: string) => {
    setSlot(null);
    setCur((c) => (c && c.room.id === roomId && !stRef.current.joined ? null : c));
  }, []);

  // Put the room where it belongs: on its page, or in the small player.
  useLayoutEffect(() => {
    const h = host.current;
    if (!h) return;
    const target = slot || (cur && st.joined ? mini.current : null);
    if (target) { if (h.parentNode !== target) target.appendChild(h); }
    else if (h.parentNode) h.parentNode.removeChild(h);
  }, [slot, cur, st.joined, mounted]);

  // Left or ended while on another page: close the small player.
  useEffect(() => {
    if (!cur) return;
    if (!slot && (!st.joined || st.ended)) { setCur(null); setSt({ joined: false, ended: false }); }
  }, [st, slot, cur]);

  // Came back to the site after closing it in the middle of a live: offer the way back in (if it's still on).
  useEffect(() => {
    if (cur) { setBack(null); return; }
    const r = rememberedLive();
    if (!r || path === `/spaces/${r.id}`) { setBack(null); return; }
    let stop = false;
    supabaseBrowser().from("live_rooms").select("ended_at").eq("id", r.id).maybeSingle().then(({ data }) => {
      if (stop) return;
      if (!data || data.ended_at) { forgetLive(r.id); setBack(null); } else setBack({ id: r.id, title: r.title });
    }, () => {});
    return () => { stop = true; };
  }, [path, cur]);

  const onState = useCallback((s: { joined: boolean; ended: boolean }) => setSt(s), []);

  return (
    <Ctx.Provider value={{ attach, detach }}>
      {children}
      <div ref={mini} className={"lv-dock" + (cur && !slot && st.joined ? " on" : "")} aria-label="Live player" />
      {back && !cur && (
        <div className="lv-dock on lv-back">
          <Link href={`/spaces/${back.id}`} className="lv-mini-t">
            <span className="room-live"><i />Live</span>
            <span className="lv-mini-txt"><b>{back.title}</b><small>Tap to go back into the live</small></span>
          </Link>
          <button type="button" className="lv-back-x" aria-label="Dismiss" onClick={() => { forgetLive(back.id); setBack(null); }}>✕</button>
        </div>
      )}
      {mounted && cur && host.current && createPortal(
        <LiveRoom key={cur.room.id} room={cur.room} me={cur.me} mini={!slot} autoJoin={cur.auto} onState={onState} />,
        host.current,
      )}
    </Ctx.Provider>
  );
}

/** Where the live shows on its own page. */
export function LiveSlot({ room, me }: { room: LiveRoomInfo; me: LiveMe }) {
  const dock = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dock || !ref.current) return;
    dock.attach(room, me, ref.current);
    return () => dock.detach(room.id);
  }, [room.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!dock) return <LiveRoom room={room} me={me} />;
  return <div ref={ref} className="lv-slot" />;
}
