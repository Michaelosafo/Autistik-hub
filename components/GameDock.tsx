"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { bootHyperfocus } from "@/app/hyperfocus/HFBoot";

/**
 * Keeps Hyperfocus GP running while you use the rest of the site, like the live voice player (LiveDock): the game's
 * page is built once here in the layout and moved into /hyperfocus while you're on it. If you leave in the middle of
 * a race, the race screen shrinks into a small floating window at the bottom of the screen and keeps going; tap it
 * to go back full size, or ✕ to end the race.
 */
type Opts = { css: string; markup: string; cls: string; nonce?: string };
type Dock = { attach: (el: HTMLElement, o: Opts) => void; detach: () => void };
const Ctx = createContext<Dock | null>(null);
const game = () => (window as any).HFGame as undefined | { racing(): boolean; label(): string; mini(on: boolean): void; close(): void; exit(): void };

export default function GameDock({ children }: { children: React.ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  const stageHome = useRef<{ parent: Node; next: Node | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // While you're away the game's page waits here, hidden but still in the document, so the race keeps running.
  const hold = useRef<HTMLDivElement>(null);
  const [mini, setMini] = useState(false);
  const [cls, setCls] = useState("");
  const [label, setLabel] = useState("");

  const stageBack = useCallback(() => {
    const st = box.current?.querySelector(".stage");
    const home = stageHome.current;
    if (st && home) home.parent.insertBefore(st, home.next && home.next.parentNode === home.parent ? home.next : null);
  }, []);

  const attach = useCallback((el: HTMLElement, o: Opts) => {
    if (!host.current) {
      // The game's styles go in <head> so the small window keeps them while the page part is put away.
      if (!document.getElementById("hf-css")) { const s = document.createElement("style"); s.id = "hf-css"; s.textContent = o.css; document.head.appendChild(s); }
      const h = document.createElement("div");
      h.innerHTML = `<div class="hf ${o.cls}">${o.markup}</div>`;
      host.current = h;
      setCls(o.cls);
      el.appendChild(h);
      bootHyperfocus(o.nonce);
      return;
    }
    el.appendChild(host.current);
    if (mini) { stageBack(); setMini(false); game()?.mini(false); }
  }, [mini, stageBack]);

  const detach = useCallback(() => {
    const h = host.current;
    if (!h) return;
    const g = game();
    const st = h.querySelector(".stage");
    if (g && g.racing() && st && box.current) {
      stageHome.current = { parent: st.parentNode!, next: st.nextSibling };
      g.mini(true);
      box.current.appendChild(st);
      setMini(true);
    } else {
      // Not racing: put the game away; it opens again instantly next time.
      g?.exit();
      document.body.classList.remove("immersive", "racing");
    }
    hold.current?.appendChild(h);
  }, []);

  // The label under the window (race on / finished).
  useEffect(() => {
    if (!mini) return;
    const t = () => setLabel(game()?.label() || "Race · tap to go back");
    t();
    const id = setInterval(t, 1500);
    return () => clearInterval(id);
  }, [mini]);

  const close = () => {
    game()?.close();
    stageBack();
    setMini(false);
  };

  return (
    <Ctx.Provider value={{ attach, detach }}>
      {children}
      <div ref={hold} hidden aria-hidden="true" />
      <div className={"gd-dock" + (mini ? " on" : "")} aria-label="Race in progress" aria-hidden={!mini}>
        <Link href="/hyperfocus" className="gd-open" aria-label="Back to the race">
          <div ref={box} className={"hf gd-mini " + cls} />
          <span className="gd-lbl">🏎️ {label}</span>
        </Link>
        <button type="button" className="gd-x" aria-label="End the race" onClick={close}>✕</button>
      </div>
    </Ctx.Provider>
  );
}

/** Where the game shows on /hyperfocus. */
export function GameSlot(o: Opts) {
  const dock = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dock || !ref.current) return;
    dock.attach(ref.current, o);
    return () => dock.detach();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="gd-slot" />;
}
