/* Hyperfocus GP: racing with friends over Supabase Realtime.
 * Gives the game the same small "room" interface it uses inside Claude:
 * join(code) -> { peers(), presence(patch), onPeers(fn), leave() }.
 * Each player broadcasts their own state (about 10 times a second while racing, every 2 s otherwise).
 * Players who go quiet for 7 s drop out of the list. Nothing is stored. */
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
          const ch = sb.channel("hyperfocus:" + name, { config: { broadcast: { self: false } } });
          const mine = {};
          const peers = new Map();
          const listeners = new Set();
          let lastSend = 0, dirty = false, timer = null, done = false;
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
            lastSend = now; dirty = false;
            ch.send({ type: "broadcast", event: "p", payload: { peer: myPeer, p: mine } }).catch(() => {});
          };
          ch.on("broadcast", { event: "p" }, (msg) => {
            const d = msg && msg.payload;
            if (!d || typeof d.peer !== "string" || d.peer === myPeer || d.peer.length > 40) return;
            if (d.bye) { peers.delete(d.peer); notify(); return; }
            const isNew = !peers.has(d.peer);
            const p = d.p && typeof d.p === "object" ? d.p : {};
            peers.set(d.peer, { p, t: Date.now() });
            notify();
            if (isNew) send(true); // say hello back so newcomers see us at once
          });
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
              clearInterval(timer);
              ch.send({ type: "broadcast", event: "p", payload: { peer: myPeer, bye: 1 } }).catch(() => {});
              setTimeout(() => sb.removeChannel(ch), 200);
              return Promise.resolve();
            },
          };
          ch.subscribe((status) => {
            if (status === "SUBSCRIBED" && !done) {
              done = true;
              timer = setInterval(() => {
                const now = Date.now();
                if (dirty || now - lastSend > 2000) send(true);
                let changed = false;
                peers.forEach((v, k) => { if (now - v.t > 7000) { peers.delete(k); changed = true; } });
                if (changed) notify();
              }, 100);
              send(true);
              resolve(api);
            } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !done) {
              done = true;
              sb.removeChannel(ch);
              reject({ code: "upstream_error" });
            }
          });
          setTimeout(() => { if (!done) { done = true; sb.removeChannel(ch); reject({ code: "upstream_error" }); } }, 10000);
        });
      },
    };
  };
})();
