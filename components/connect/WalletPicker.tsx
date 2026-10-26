"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import NetIcon from "@/components/connect/NetIcon";
import { listWallets, type ListedWallet } from "@/lib/connect";
import { chooseSolInjected, chooseSolWalletConnect, injectedFor, injectedSolFor, warmUp } from "@/lib/connect";
import { NETWORKS, SOL_APPS, TOP_NETWORKS, TOP_WALLETS, WALLETCONNECT_ID, cancelQr, chooseInjected, chooseSol, chooseWalletConnect, closePicker, getState, isMobile, lastWalletName, legacyInjected, netOf, setNetwork, startDiscovery, subscribe } from "@/lib/connect";

type Row = { key: string; name: string; logo: string | null; color?: string; badge?: string; sub: string; here?: boolean; go: () => void };

/** The "Connect a wallet" window. Mounted once (in the site frame); opened by pickWallet() from anywhere. */
export default function WalletPicker() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const [q, setQ] = useState("");
  const [last, setLast] = useState("");
  const [allNets, setAllNets] = useState(false);
  const [netQ, setNetQ] = useState("");
  const [qrImg, setQrImg] = useState("");
  // Every WalletConnect wallet (600+), loaded when asked for or searched.
  const [showAll, setShowAll] = useState(false);
  const [all, setAll] = useState<{ list: ListedWallet[]; total: number; page: number; loading: boolean }>({ list: [], total: 0, page: 0, loading: false });
  const loadAll = (page: number, search: string, add: boolean) => {
    setAll((a) => ({ ...a, loading: true }));
    listWallets(page, search).then(({ wallets, total }) => setAll((a) => ({ list: add ? [...a.list, ...wallets] : wallets, total, page, loading: false })));
  };
  useEffect(() => {
    if (!s.open || (!showAll && !q)) return;
    const t = setTimeout(() => loadAll(1, q, false), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, showAll, s.open]);
  useEffect(() => {
    setQrImg("");
    if (s.qr) import("qrcode").then((m) => m.toDataURL(s.qr!.uri, { margin: 1, width: 260, color: { dark: "#191326", light: "#FFFFFF" } })).then(setQrImg).catch(() => {});
  }, [s.qr]);
  useEffect(() => { startDiscovery(); }, []);
  useEffect(() => { if (s.open) warmUp(); }, [s.network, s.open]);
  useEffect(() => {
    if (!s.open) return;
    setQ(""); setLast(lastWalletName()); setShowAll(false);
    warmUp();
    const k = (e: KeyboardEvent) => e.key === "Escape" && closePicker();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [s.open]);

  const mobile = typeof window !== "undefined" && isMobile();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const d of s.detected) {
      const top = TOP_WALLETS.find((w) => w.rdns.includes(d.info.rdns));
      out.push({
        key: d.info.uuid, name: d.info.name, logo: top ? `/wallets/${top.id}.svg` : d.info.icon || null,
        badge: d.info.name === last ? "Last used" : "Installed", sub: "Ready on this device", here: true, go: () => chooseInjected(d.info.name, d.provider),
      });
    }
    const legacy = !s.detected.length && !TOP_WALLETS.some((w) => injectedFor(w.id)) ? legacyInjected() : null;
    if (legacy) out.push({ key: "legacy", name: "This app's wallet", logo: null, badge: "Detected", sub: "The wallet built into this browser", here: true, go: () => chooseInjected("Browser wallet", legacy) });
    for (const w of TOP_WALLETS) {
      if (s.detected.some((d) => w.rdns.includes(d.info.rdns))) continue;
      // Already in this browser (extension, or the wallet app's own browser): connect right here, approve in it.
      const inj = injectedFor(w.id);
      if (inj) {
        out.push({ key: "inj-" + w.id, name: w.name, logo: `/wallets/${w.id}.svg`, badge: w.name === last ? "Last used" : "Installed", sub: "Ready on this device: approve in the wallet", here: true,
          go: () => chooseInjected(w.name, inj) });
        continue;
      }
      const viaWc = !!WALLETCONNECT_ID;
      // Each wallet opens that wallet: its app on a phone, or a code to scan with its app on a computer.
      const phoneWc = mobile && viaWc && !!(w.wc || w.native), phoneDapp = mobile && !phoneWc && !!w.dapp;
      out.push({
        key: w.id, name: w.name, logo: `/wallets/${w.id}.svg`, color: w.color,
        badge: w.name === last ? "Last used" : undefined,
        sub: phoneWc ? `Opens ${w.name}` : phoneDapp ? `Opens this site in ${w.name}` : mobile ? (viaWc ? "Pick it in the WalletConnect list" : "Get the app")
          : viaWc ? `Scan with ${w.name} on your phone` : "Get the app",
        go: () => {
          if (phoneWc) { chooseWalletConnect(w.id); return; }
          if (phoneDapp) { location.href = w.dapp!(location.href); return; }
          if (viaWc) { chooseWalletConnect(mobile ? undefined : w.id); return; }
          window.open(w.install, "_blank", "noopener,noreferrer");
        },
      });
    }
    return out;
  }, [s.detected, last, mobile]);

  // Solana: the Solana wallets on this device, or the apps to get one.
  const solRows = useMemo<Row[]>(() => {
    const out: Row[] = s.solFound.map((w) => ({
      key: "sol-" + w.name, name: w.name, logo: w.icon || null, badge: w.name === last ? "Last used" : "Installed", sub: "Ready on this device", here: true,
      go: () => { chooseSol(w); },
    }));
    const first = (n: string) => n.toLowerCase().split(" ")[0];
    for (const a of SOL_APPS) {
      if (s.solFound.some((w) => first(w.name) === first(a.name))) continue;
      if (injectedSolFor(a.id)) {
        out.unshift({ key: "sol-inj-" + a.id, name: a.name, logo: a.logo, badge: a.name === last ? "Last used" : "Installed", sub: "Ready on this device: approve in the wallet", here: true,
          go: () => { chooseSolInjected(a.id, a.name, a.logo); } });
        continue;
      }
      // Bitget, Trust, OKX: approve in the wallet app (or scan its code) and stay in this browser, like WalletConnect
      // on the other networks. Phantom, Solflare, Backpack, Coinbase: open this site inside the app on a phone.
      const viaWc = !!WALLETCONNECT_ID && !!(a.wc || a.native);
      out.push({ key: "sol-app-" + a.id, name: a.name, logo: a.logo,
        sub: viaWc ? (mobile ? `Opens ${a.name} to approve` : `Scan with ${a.name} on your phone`) : mobile ? `Opens this site in ${a.name}` : "Not on this browser: get the app",
        go: () => {
          if (viaWc) { chooseSolWalletConnect({ name: a.name, logo: a.logo, wc: a.wc, native: a.native, install: a.install }); return; }
          if (mobile) location.href = a.dapp(location.href); else window.open(a.install, "_blank", "noopener,noreferrer");
        } });
    }
    return out;
  }, [s.solFound, last, mobile]);

  if (!s.open) return null;
  const solMode = s.network === "solana";
  const pool = solMode ? solRows : rows;
  const shown = q ? pool.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : pool;
  const installed = shown.filter((r) => r.here);
  const others = shown.filter((r) => !r.here);

  const RowBtn = ({ r }: { r: Row }) => (
    <button type="button" className="wp-row" disabled={!!s.busy} onClick={r.go}>
      {r.logo ? <img src={r.logo} alt="" width={40} height={40} loading="lazy" decoding="async" /> : <span className="wp-ph">{r.name.slice(0, 1)}</span>}
      <span className="wp-row-t"><b>{r.name}</b><small>{s.busy === r.name ? "Check your wallet…" : r.sub}</small></span>
      {r.badge && <span className={"wp-badge" + (r.badge === "Last used" ? " gold" : "")}>{r.badge}</span>}
      <i className="wp-chev" aria-hidden="true" />
    </button>
  );

  return (
    <div className="wp-bg" onClick={closePicker}>
      <div className="wp" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="wp-main">
          <div className="wp-head">
            <div><b>Connect a wallet</b><small>Pick your network, then your wallet</small></div>
            <button type="button" className="wp-x" onClick={closePicker} aria-label="Close">×</button>
          </div>
          <div className="wp-nets" role="radiogroup" aria-label="Network">
            {[...TOP_NETWORKS, ...(TOP_NETWORKS.includes(s.network) ? [] : [s.network])].map((k) => netOf(k)).map((n) => (
              <button key={n.key} type="button" role="radio" aria-checked={s.network === n.key} className={"wp-net" + (s.network === n.key ? " on" : "")}
                onClick={() => { setNetwork(n.key); setAllNets(false); }} disabled={!!s.busy}>
                <NetIcon n={n} size={16} />{n.name}
              </button>
            ))}
            <button type="button" className={"wp-net" + (allNets ? " on" : "")} aria-expanded={allNets} onClick={() => setAllNets(!allNets)}>
              All {NETWORKS.length} networks {allNets ? "▴" : "▾"}
            </button>
          </div>
          {allNets && (
            <div className="wp-allnets">
              <input className="wp-search" value={netQ} onChange={(e) => setNetQ(e.target.value)} placeholder="Search networks" aria-label="Search networks" autoComplete="off" spellCheck={false} />
              <div className="wp-netgrid">
                {NETWORKS.filter((n) => !netQ || n.name.toLowerCase().includes(netQ.toLowerCase())).map((n) => (
                  <button key={n.key} type="button" className={"wp-net" + (s.network === n.key ? " on" : "")} onClick={() => { setNetwork(n.key); setAllNets(false); setNetQ(""); }}>
                    <NetIcon n={n} size={16} />{n.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {s.qr && (
            <div className="wp-qr">
              <div className="wp-qr-h"><img src={s.qr.logo} alt="" width={28} height={28} /><b>Scan with {s.qr.name}</b></div>
              {s.qr.href ? <>
                <a className="btn primary wp-open" href={s.qr.href}>Open {s.qr.name}</a>
                <small>Approve the connection in {s.qr.name}, then come back here. Network: {netOf(s.network).name}. If nothing opened, tap the button.</small>
              </> : <>
              {qrImg ? <img className="wp-qr-img" src={qrImg} alt={`WalletConnect code for ${s.qr.name}`} width={260} height={260} /> : <div className="wp-qr-img wp-qr-wait">Making the code…</div>}
              <small>Open {s.qr.name} on your phone, tap its scan button, and point it here. Network: {netOf(s.network).name}.</small>
              </>}
              <div className="wp-qr-r">
                {!s.qr.href && <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(s.qr!.uri).catch(() => {})}>Copy link</button>}
                <button type="button" className="btn small" onClick={cancelQr}>← Other wallets</button>
                {s.qr.install && <a className="btn small" href={s.qr.install} target="_blank" rel="noopener noreferrer">Get {s.qr.name}</a>}
              </div>
            </div>
          )}
          {!s.qr && <>
          <input className="wp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wallets" aria-label="Search wallets" autoComplete="off" spellCheck={false} />
          <div className="wp-list">
            {installed.length > 0 && <div className="wp-label">On this device</div>}
            {installed.map((r) => <RowBtn key={r.key} r={r} />)}
            {!solMode && <>
            <div className="wp-label">Any wallet</div>
            <button type="button" className="wp-wc" disabled={!!s.busy} onClick={() => { if (mobile) { setShowAll(true); setTimeout(() => document.querySelector(".wp-more, .wp-list .wp-label:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); } else chooseWalletConnect(); }}>
            <img src="/wallets/walletconnect.svg" alt="" width={40} height={40} />
            <span className="grow"><b>WalletConnect</b><small>{WALLETCONNECT_ID ? (s.busy === "WalletConnect" ? "Opening…" : (mobile ? `600+ wallet apps · opens your wallet app directly` : `300+ wallets on ${netOf(s.network).name} · QR code or open your app`)) : "Coming soon"}</small></span>
            <i className="wp-chev" aria-hidden="true" />
          </button>
            </>}
            {others.length > 0 && <div className="wp-label">{solMode ? "Solana wallets" : "Popular"}</div>}
            {others.map((r) => <RowBtn key={r.key} r={r} />)}
            {!solMode && WALLETCONNECT_ID && (() => {
              const known = new Set(rows.map((r) => r.name.toLowerCase()));
              const extra = all.list.filter((w) => !known.has(w.name.toLowerCase()));
              if (!showAll && !q) return <button type="button" className="wp-more" onClick={() => setShowAll(true)}>Show all wallets (600+) ▾</button>;
              return <>
                <div className="wp-label">{q ? "More wallets" : `All wallets${all.total ? ` (${all.total})` : ""}`}</div>
                {extra.map((w) => {
                  const here = w.rdns ? s.detected.find((d) => d.info.rdns === w.rdns) : undefined;
                  const r: Row = {
                    key: "all-" + w.id, name: w.name, logo: w.logo || null, here: false,
                    badge: here ? "Installed" : undefined,
                    sub: here ? "Ready on this device" : mobile ? (w.wc || w.native ? `Opens ${w.name}` : "Pick it in the WalletConnect list") : `Scan with ${w.name} on your phone`,
                    go: () => {
                      if (here) { chooseInjected(here.info.name, here.provider); return; }
                      chooseWalletConnect(mobile && !w.wc && !w.native ? undefined : { name: w.name, logo: w.logo, wc: w.wc, native: w.native, install: w.install });
                    },
                  };
                  return <RowBtn key={r.key} r={r} />;
                })}
                {all.loading && <div className="wp-empty">Loading wallets…</div>}
                {!all.loading && all.list.length < all.total && (
                  <button type="button" className="wp-more" onClick={() => loadAll(all.page + 1, q, true)}>Load more wallets</button>
                )}
              </>;
            })()}
            {!shown.length && (solMode || !WALLETCONNECT_ID) && <div className="wp-empty">{solMode ? <>No Solana wallet called &ldquo;{q}&rdquo;.</> : <>No wallet called &ldquo;{q}&rdquo;. Try WalletConnect: it works with 300+ wallets.</>}</div>}
          </div>
          </>}
          {s.error && <div className="wp-err" role="alert">{s.error}</div>}
          {!solMode && mobile && (s.error || last) && (
            <div className="wp-label" style={{ marginTop: 8 }}>Still not connecting? Open this site inside your wallet app</div>
          )}
          {!solMode && mobile && (s.error || last) && TOP_WALLETS.filter((w) => w.dapp).slice(0, 5).map((w) => (
            <a key={w.id} className="wp-row" href={w.dapp!(location.href)}>
              <img src={`/wallets/${w.id}.svg`} alt="" width={40} height={40} loading="lazy" decoding="async" />
              <span className="wp-row-t"><b>{w.name}</b><small>Opens autistik.io in the app&apos;s browser</small></span>
              <i className="wp-chev" aria-hidden="true" />
            </a>
          ))}
        </div>

        <aside className="wp-side" aria-label="About wallets">
          <div className="wp-side-art" aria-hidden="true"><svg width="88" height="44"><use href="#i-inf" /></svg></div>
          <b>What is a wallet?</b>
          <p><strong>Your own account for crypto.</strong> It holds your coins and signs every action, so nobody else can move them.</p>
          <p><strong>A new way to sign in.</strong> No password: you approve each step in your wallet app.</p>
          <p className="wp-safe">AUTISTIK will never ask for your seed phrase or private key. Connecting only shares your address: nothing moves unless you approve it in your wallet. <a href="/terms" target="_blank" rel="noopener">Terms</a></p>
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="wp-get">Get a wallet</a>
        </aside>
      </div>
    </div>
  );
}
