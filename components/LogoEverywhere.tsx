"use client";
import { useState } from "react";

/**
 * EVM coins have no standard place for a picture on the blockchain itself: explorers, DexScreener, wallets and DEXes
 * each take it from their own list. This gives the creator one permanent logo link, our token list, and the right form
 * on each platform (most ask the creator to prove they launched it, so we can't submit for them).
 */
export default function LogoEverywhere({ chain, token, explorer, pair, hasLogo }: { chain: string; token: string; explorer: string; pair: string | null; hasLogo: boolean }) {
  const [copied, setCopied] = useState("");
  const site = typeof location !== "undefined" ? location.origin : "https://autistik.io";
  const logo = `${site}/api/launchpad/logo/${chain}/${token}`;
  const list = `${site}/tokenlist.json`;
  const etherscanLike = !/blockscout/.test(explorer);
  const copy = (t: string, what: string) => navigator.clipboard?.writeText(t).then(() => { setCopied(what); setTimeout(() => setCopied(""), 1800); }).catch(() => {});
  return (
    <details className="le">
      <summary>🖼️ Show this coin&apos;s logo everywhere</summary>
      <div className="le-body">
        <small className="muted">{hasLogo ? "Already showing on AUTISTIK and in our token list. Other sites keep their own copy, so submit it once on each:" : "Add a logo when you launch, or ask the team to add one. Then submit it on each site:"}</small>
        <div className="le-row">
          <button type="button" className="le-chip" onClick={() => copy(logo, "logo")} disabled={!hasLogo}>{copied === "logo" ? "✓ Copied" : "Copy logo link"}</button>
          <button type="button" className="le-chip" onClick={() => copy(list, "list")}>{copied === "list" ? "✓ Copied" : "Copy token list link"}</button>
        </div>
        <ul className="le-list">
          <li><a href={etherscanLike ? `${explorer}/tokenupdate?a=${token}` : `${explorer}/token/${token}`} target="_blank" rel="noopener noreferrer">Explorer</a><small>Free. Sign with the wallet that launched it.</small></li>
          <li><a href="https://marketplace.dexscreener.com/product/token-info" target="_blank" rel="noopener noreferrer">DexScreener</a><small>Paid by DexScreener. Shows logo, links and banner.</small></li>
          {pair && <li><a href={`https://www.geckoterminal.com/search?query=${token}`} target="_blank" rel="noopener noreferrer">GeckoTerminal</a><small>Free. &ldquo;Update token info&rdquo; on the coin&apos;s page.</small></li>}
          <li><a href="https://www.coingecko.com/request-form" target="_blank" rel="noopener noreferrer">CoinGecko</a><small>Free listing request.</small></li>
          <li><span>Wallets &amp; DEXes</span><small>Import our token list link: every AUTISTIK coin shows with its picture.</small></li>
        </ul>
      </div>
    </details>
  );
}
