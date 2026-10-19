"use client";
import { useEffect, useSyncExternalStore } from "react";
import { TOP_WALLETS, WALLETCONNECT_ID, chooseInjected, chooseWalletConnect, closePicker, getState, isMobile, legacyInjected, startDiscovery, subscribe } from "@/lib/connect";

/** The "Connect a wallet" sheet. Mounted once (in the Shell); opened by pickWallet() from anywhere. */
export default function WalletPicker() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => { startDiscovery(); }, []);
  useEffect(() => {
    if (!s.open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && closePicker();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [s.open]);
  if (!s.open) return null;

  const known = new Set(TOP_WALLETS.flatMap((w) => w.rdns));
  const legacy = !s.detected.length ? legacyInjected() : null;
  const others = TOP_WALLETS.filter((w) => !s.detected.some((d) => w.rdns.includes(d.info.rdns)));
  const mobile = isMobile();

  function openTop(w: (typeof TOP_WALLETS)[number]) {
    if (WALLETCONNECT_ID) return chooseWalletConnect();
    if (mobile && w.dapp) { location.href = w.dapp(location.href); return; }
    window.open(w.install, "_blank", "noopener,noreferrer");
  }
  const hint = (w: (typeof TOP_WALLETS)[number]) => (WALLETCONNECT_ID ? (mobile ? "Opens the app" : "Scan QR") : mobile && w.dapp ? "Open in app" : "Get it");

  return (
    <div className="wp-bg" onClick={closePicker}>
      <div className="wp" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="wp-head"><b>Connect a wallet</b><button type="button" className="wp-x" onClick={closePicker} aria-label="Close">×</button></div>

        {(s.detected.length > 0 || legacy) && (
          <>
            <div className="wp-label">On this device</div>
            <div className="wp-grid">
              {s.detected.map((d) => (
                <button key={d.info.uuid} type="button" className="wp-w" disabled={!!s.busy} onClick={() => chooseInjected(d.info.name, d.provider)}>
                  {d.info.icon ? <img src={d.info.icon} alt="" width={36} height={36} /> : <span className="wp-ph">{d.info.name.slice(0, 2)}</span>}
                  <b>{d.info.name}</b><small>{s.busy === d.info.name ? "Check your wallet…" : known.has(d.info.rdns) ? "Installed" : "Detected"}</small>
                </button>
              ))}
              {legacy && (
                <button type="button" className="wp-w" disabled={!!s.busy} onClick={() => chooseInjected("Browser wallet", legacy)}>
                  <span className="wp-ph">W</span><b>This app&apos;s wallet</b><small>{s.busy === "Browser wallet" ? "Check your wallet…" : "Detected"}</small>
                </button>
              )}
            </div>
          </>
        )}

        <div className="wp-label">Popular wallets</div>
        <div className="wp-grid">
          {others.map((w) => (
            <button key={w.id} type="button" className="wp-w" disabled={!!s.busy} onClick={() => openTop(w)}>
              <span className="wp-ph" style={{ background: w.color, color: w.id === "binance" || w.id === "bitget" ? "#111" : "#fff" }}>{w.name.slice(0, 1)}</span>
              <b>{w.name}</b><small>{hint(w)}</small>
            </button>
          ))}
        </div>

        <button type="button" className="wp-wc" disabled={!!s.busy} onClick={chooseWalletConnect}>
          <span className="wp-wc-logo" aria-hidden="true">
            <svg viewBox="0 0 40 25" width="28" height="18"><path fill="currentColor" d="M8.2 4.9c6.5-6.3 17.1-6.3 23.6 0l.8.8c.3.3.3.8 0 1.1l-2.7 2.6c-.2.2-.4.2-.6 0l-1.1-1c-4.5-4.4-11.9-4.4-16.4 0l-1.2 1.1c-.2.2-.4.2-.6 0L7.3 6.9c-.3-.3-.3-.8 0-1.1l.9-.9zm29.1 5.4 2.4 2.3c.3.3.3.8 0 1.1L28.9 24.2c-.3.3-.8.3-1.2 0l-7.6-7.4c-.1-.1-.2-.1-.3 0l-7.6 7.4c-.3.3-.8.3-1.2 0L.3 13.7c-.3-.3-.3-.8 0-1.1l2.4-2.3c.3-.3.8-.3 1.2 0l7.6 7.4c.1.1.2.1.3 0l7.6-7.4c.3-.3.8-.3 1.2 0l7.6 7.4c.1.1.2.1.3 0l7.6-7.4c.3-.3.8-.3 1.2 0z" /></svg>
          </span>
          <span className="grow"><b>WalletConnect</b><small>{WALLETCONNECT_ID ? (s.busy === "WalletConnect" ? "Opening…" : "300+ wallets: scan a QR code or open your wallet app") : "Coming soon"}</small></span>
        </button>

        {s.error && <div className="wp-err" role="alert">{s.error}</div>}
        <p className="wp-note">Your keys stay in your wallet. AUTISTIK will never ask for your seed phrase or private key.</p>
      </div>
    </div>
  );
}
