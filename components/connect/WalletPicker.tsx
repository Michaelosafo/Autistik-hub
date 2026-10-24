"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NETWORKS, SOL_APPS, TOP_WALLETS, WALLETCONNECT_ID, chooseInjected, chooseSol, chooseWalletConnect, closePicker, getState, isMobile, lastWalletName, legacyInjected, netOf, setNetwork, startDiscovery, subscribe } from "@/lib/connect";

type Row = { key: string; name: string; logo: string | null; color?: string; badge?: string; sub: string; here?: boolean; go: () => void };

/** The "Connect a wallet" window. Mounted once (in the site frame); opened by pickWallet() from anywhere. */
export default function WalletPicker() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const [q, setQ] = useState("");
  const [last, setLast] = useState("");
  useEffect(() => { startDiscovery(); }, []);
  useEffect(() => {
    if (!s.open) return;
    setQ(""); setLast(lastWalletName());
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
    const legacy = !s.detected.length ? legacyInjected() : null;
    if (legacy) out.push({ key: "legacy", name: "This app's wallet", logo: null, badge: "Detected", sub: "The wallet built into this browser", here: true, go: () => chooseInjected("Browser wallet", legacy) });
    for (const w of TOP_WALLETS) {
      if (s.detected.some((d) => w.rdns.includes(d.info.rdns))) continue;
      const viaWc = !!WALLETCONNECT_ID;
      out.push({
        key: w.id, name: w.name, logo: `/wallets/${w.id}.svg`, color: w.color,
        badge: w.name === last ? "Last used" : undefined,
        sub: viaWc ? (mobile ? "Opens the app" : "Scan with your phone") : mobile && w.dapp ? "Open this site in the app" : "Get the app",
        go: () => {
          if (viaWc) return chooseWalletConnect(w.id);
          if (mobile && w.dapp) { location.href = w.dapp(location.href); return; }
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
    for (const a of SOL_APPS) {
      if (s.solFound.some((w) => w.name.toLowerCase().startsWith(a.name.toLowerCase()))) continue;
      out.push({ key: "sol-app-" + a.id, name: a.name, logo: a.id === "phantom" ? "/wallets/phantom.svg" : null, sub: mobile ? "Opens this site in the app" : "Get the app",
        go: () => { if (mobile) location.href = a.dapp(location.href); else window.open(a.install, "_blank", "noopener,noreferrer"); } });
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
            {NETWORKS.map((n) => (
              <button key={n.key} type="button" role="radio" aria-checked={s.network === n.key} className={"wp-net" + (s.network === n.key ? " on" : "")}
                onClick={() => setNetwork(n.key)} disabled={!!s.busy}>
                <i style={{ background: n.color }} aria-hidden="true" />{n.name}
              </button>
            ))}
          </div>
          <input className="wp-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wallets" aria-label="Search wallets" autoComplete="off" spellCheck={false} />
          <div className="wp-list">
            {installed.length > 0 && <div className="wp-label">On this device</div>}
            {installed.map((r) => <RowBtn key={r.key} r={r} />)}
            {!solMode && <>
            <div className="wp-label">Any wallet</div>
            <button type="button" className="wp-wc" disabled={!!s.busy} onClick={() => chooseWalletConnect()}>
            <img src="/wallets/walletconnect.svg" alt="" width={40} height={40} />
            <span className="grow"><b>WalletConnect</b><small>{WALLETCONNECT_ID ? (s.busy === "WalletConnect" ? "Opening…" : `300+ wallets on ${netOf(s.network).name} · QR code or open your app`) : "Coming soon"}</small></span>
            <i className="wp-chev" aria-hidden="true" />
          </button>
            </>}
            {others.length > 0 && <div className="wp-label">{solMode ? "Get a Solana wallet" : "Popular"}</div>}
            {others.map((r) => <RowBtn key={r.key} r={r} />)}
            {!shown.length && <div className="wp-empty">{solMode ? <>No Solana wallet called &ldquo;{q}&rdquo;.</> : <>No wallet called &ldquo;{q}&rdquo;. Try WalletConnect: it works with 300+ wallets.</>}</div>}
          </div>
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
          <p className="wp-safe">AUTISTIK will never ask for your seed phrase or private key.</p>
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="wp-get">Get a wallet</a>
        </aside>
      </div>
    </div>
  );
}
