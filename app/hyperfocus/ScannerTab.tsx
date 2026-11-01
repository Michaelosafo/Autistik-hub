"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import ScanTools from "@/components/ScanTools";

/**
 * The Scanner tab of Hyperfocus: the site's full token scanner first (token scan with the buy/sell read, safety grade
 * and honeypot check; the dev wallet with past tokens and how many bonded), then the game's wallet & holders scanner,
 * which the game script moves into #hfScanMount.
 */
export default function ScannerTab({ signedIn }: { signedIn: boolean }) {
  const [tab, setTab] = useState("");
  useEffect(() => {
    const on = (e: any) => setTab(String(e.detail || ""));
    window.addEventListener("hf-tab", on);
    setTab((window as any).HFTab || "");
    return () => window.removeEventListener("hf-tab", on);
  }, []);
  if (tab !== "scanner") return null;
  return (
    <div className="stack scan-page hfs" style={{ maxWidth: 1080, margin: "0 auto 18px", padding: "0 16px" }}>
      <style>{CSS}</style>
      <section className="an-hero">
        <div className="an-hero-top">
          <div>
            <div className="an-kicker">AUTISTIK · SCANNER</div>
            <h2 className="hfs-h">Scan before you buy</h2>
            <p className="an-sub">Paste a token for the buy or sell read, safety grade and top holders. Paste a dev wallet to see their past tokens, how many bonded, and the chance this one does well.</p>
          </div>
          <div className="an-live"><i />Live</div>
        </div>
        <ScanTools signedIn={signedIn} />
        <div className="hfs-feats">
          <span><b>Buy / sell read</b><small>Wait, buy, take profit or avoid</small></span>
          <span><b>Safety grade A–F</b><small>Honeypot test, taxes, contract checks</small></span>
          <span><b>Dev wallet</b><small>Past tokens, bonded, dead, still holding</small></span>
          <span><b>Top 40 holders</b><small>Bundles, whales and sell alerts</small></span>
        </div>
        <Link href="/pro" className="an-pro"><b>Pro</b> · 3 timeframes, whale radar, track record &amp; analyst report →</Link>
      </section>
      <div className="hfs-sub">
        <h3>Wallet &amp; holders scan</h3>
        <p className="muted">Any wallet: balances on every network. Any token: who holds it, who bought with you, the 100x club and who is selling. Then race them.</p>
      </div>
      <div id="hfScanMount" className="hf hfs-mount" />
    </div>
  );
}

const CSS = `
.hfs .hfs-h{color:#fff;margin:4px 0 6px;font-size:clamp(1.6em,4vw,2.2em)}
.hfs-feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.hfs-feats span{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.hfs-feats b{color:#fff;font-size:.95em}.hfs-feats small{color:rgba(233,236,248,.7);font-size:.8em}
.hfs-sub h3{margin:6px 0 2px}.hfs-sub p{margin:0;font-size:.9em}
.hfs-mount.hf{padding:0;background:transparent}
`;
