"use client";
import { useEffect, type RefObject } from "react";

/**
 * Keeps a chat's newest message in view as replies arrive, get written out or gain buttons, so nobody has to
 * drag to see what was said. If the person scrolls up to re-read, it stops following until they come back down.
 */
export function useStickToBottom(ref: RefObject<HTMLElement>, deps: unknown[] = []) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    let stick = true;
    const onScroll = () => { stick = box.scrollHeight - box.scrollTop - box.clientHeight < 160; };
    const follow = () => { if (stick) box.scrollTop = box.scrollHeight; };
    box.addEventListener("scroll", onScroll, { passive: true });
    const mo = new MutationObserver(follow);
    mo.observe(box, { childList: true, subtree: true, characterData: true });
    const ro = new ResizeObserver(follow);
    ro.observe(box);
    follow();
    return () => { box.removeEventListener("scroll", onScroll); mo.disconnect(); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
