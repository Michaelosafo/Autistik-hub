/* Hyperfocus GP: racing with friends over Supabase Realtime.
 * Gives the game the same small "room" interface it uses inside Claude:
 * join(code) -> { peers(), presence(patch), onPeers(fn), leave() }.
 * Each player broadcasts their own state (about 10 times a second while racing, every 2 s otherwise).
 * Racers who go quiet for 7 s drop out; someone in the lobby stays listed for 90 s (they may be sharing the link).
 * The room reconnects by itself when the phone brings the game back. Nothing is stored. */
(function () {
  window.RallyNet = async function () {
    if (!window.supabase || !window.supabase.createClient) return null;
    let cfg = null;
    try {
      const r = await fetch("/api/hyperfocus-config", { credentials: "same-origin" });
      if (r.ok) cfg = await r.json();
    } catch (e) {}
    if (!cfg || !cfg.url || !cfg.anon) return null;
    const sb = window.supabase.createClient(cfg.url, cfg.anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const myPeer = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);

    return {
      join(name) {
        return new Promise((resolve, reject) => {
          const mine = {};
          const peers = new Map();
          const listeners = new Set();
          let ch = null, lastSend = 0, dirty = false, timer = null, done = false, left = false;
          const snapshot = () => {
            const out = [{ peer: myPeer, sameTab: true, isMe: true, by: null, guest: false, kind: "viewer", presence: { ...mine }, updatedAt: Date.now() }];
            peers.forEach((v, k) => out.push({ peer: k, sameTab: false, isMe: false, by: null, guest: false, kind: "viewer", presence: v.p, updatedAt: v.t }));
            return out;
          };
          let snap = snapshot();
          const notify = () => { snap = snapshot(); listeners.forEach((f) => { try { f({ peers: snap }); } catch (e) {} }); };
          const send = (force) => {
            const now = Date.now();
            if (!force && now - lastSend < 90) { dirty = true; return; }
            if (!ch) return;
            lastSend = now; dirty = false;
            ch.send({ type: "broadcast", event: "p", payload: { peer: myPeer, p: mine } }).catch(() => {});
          };
          // Someone waiting in the lobby may have switched apps to share the link: keep them listed for 90 s.
          // While racing, a player who goes quiet for 7 s drops out.
          const staleAfter = (v) => (v.p && v.p.st === "race" ? 7000 : 90000);
          const api = {
            name,
            peers: () => snap,
            presence(patch) {
              for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; }
              send(false); notify();
              return Promise.resolve();
            },
            onPeers(f) { listeners.add(f); setTimeout(() => f({ peers: snap }), 0); return () => listeners.delete(f); },
            leave() {
              left = true;
              clearInterval(timer);
              document.removeEventListener("visibilitychange", onVisible);
              if (ch) { const c = ch; c.send({ type: "broadcast", event: "p", payload: { peer: myPeer, bye: 1 } }).catch(() => {}); setTimeout(() => sb.removeChannel(c), 200); }
              return Promise.resolve();
            },
          };
          // (Re)connects the room channel. Phones close the connection while the game is in the background
          // (switching to WhatsApp to share the link); coming back reconnects to the same room.
          const connect = () => {
            if (left) return;
            if (ch) { try { sb.removeChannel(ch); } catch (e) {} }
            const c = sb.channel("hyperfocus:" + name, { config: { broadcast: { self: false } } });
            ch = c;
            c.on("broadcast", { event: "p" }, (msg) => {
              const d = msg && msg.payload;
              if (!d || typeof d.peer !== "string" || d.peer === myPeer || d.peer.length > 40) return;
              if (d.bye) { peers.delete(d.peer); notify(); return; }
              const isNew = !peers.has(d.peer);
              const p = d.p && typeof d.p === "object" ? d.p : {};
              peers.set(d.peer, { p, t: Date.now() });
              notify();
              if (isNew) send(true); // say hello back so newcomers see us at once
            });
            c.subscribe((status) => {
              if (c !== ch) return;
              if (status === "SUBSCRIBED") {
                send(true);
                if (!done) { done = true; resolve(api); }
              } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                if (!done) { done = true; try { sb.removeChannel(c); } catch (e) {} ch = null; reject({ code: "upstream_error" }); return; }
                if (!left && !document.hidden) setTimeout(() => { if (c === ch) connect(); }, 1500);
              }
            });
          };
          const onVisible = () => {
            if (document.hidden || left) return;
            if (!ch || ch.state !== "joined") connect(); else send(true);
          };
          document.addEventListener("visibilitychange", onVisible);
          timer = setInterval(() => {
            const now = Date.now();
            if (dirty || now - lastSend > 2000) send(true);
            let changed = false;
            peers.forEach((v, k) => { if (now - v.t > staleAfter(v)) { peers.delete(k); changed = true; } });
            if (changed) notify();
          }, 100);
          connect();
          setTimeout(() => { if (!done) { done = true; left = true; clearInterval(timer); if (ch) sb.removeChannel(ch); reject({ code: "upstream_error" }); } }, 10000);
        });
      },
    };
  };
})();
