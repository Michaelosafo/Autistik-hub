/**
 * One way to connect an outside wallet, used everywhere on the site.
 *
 * `pickWallet()` opens the "Connect a wallet" sheet and resolves with the chosen wallet's provider (EIP-1193), or
 * null if the member closes it. The sheet lists wallets already on this device (found through EIP-6963, so several
 * extensions can live side by side), the top wallets, and WalletConnect for everything else (QR code on a computer,
 * opens the wallet app on a phone). The choice is remembered for this tab.
 *
 * Browser only. Nothing here ever sees a private key: wallets sign inside their own apps.
 */
import { getWallets } from "@wallet-standard/app";
import { XCHAIN_LIST } from "@/lib/bridge-chains";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
type Detected = { info: WalletInfo; provider: any };

/**
 * Android: wallet web links whose app hasn't claimed them make the phone ask "Chrome or <wallet>?". Pointing the
 * link at the wallet's own app (an Android intent with its package) opens ONLY the wallet; if it isn't installed,
 * the phone goes to its Play Store page.
 */
const ONE_APP: { test: RegExp; scheme: string; pkg: string }[] = [
  { test: /bitkeep:|bkcode\.vip/i, scheme: "bitkeep", pkg: "com.bitkeep.wallet" },
  { test: /trust:|link\.trustwallet\.com/i, scheme: "trust", pkg: "com.wallet.crypto.trustapp" },
  { test: /metamask:|metamask\.app\.link/i, scheme: "metamask", pkg: "io.metamask" },
  { test: /okex:|okx:|www\.okx\.com/i, scheme: "okex", pkg: "com.okx.wallet" },
  { test: /bnc:|app\.binance\.com/i, scheme: "bnc", pkg: "com.binance.dev" },
  { test: /cbwallet:|go\.cb-w\.com/i, scheme: "cbwallet", pkg: "org.toshi" },
  { test: /phantom:|phantom\.app/i, scheme: "phantom", pkg: "app.phantom" },
  { test: /safepal/i, scheme: "safepalwallet", pkg: "io.safepal.wallet" },
  { test: /tokenpocket|tpoutside|tpdapp/i, scheme: "tpoutside", pkg: "vip.mytokenpocket" },
  { test: /rabby/i, scheme: "rabby", pkg: "io.rabby" },
];
/** Android: open that one wallet app. An https link also offers Chrome, so this uses the app's own scheme and package. */
export function pinAndroid(href: string): string {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return href;
  // Force an Android intent with the exact package so only the wallet app opens (no "Choose activity" / Chrome chooser).
  const hit = ONE_APP.find((a) => a.test.test(href));
  if (!hit) return href;
  // For Bitget on Android the official supported link is https://bkcode.vip. Convert it to a package-pinned intent
  // so Chrome never appears in the chooser.
  if (hit.pkg === "com.bitkeep.wallet") {
    let path = href;
    if (/^https?:\/\/bkcode\.vip/i.test(href)) {
      path = href.replace(/^https?:\/\//i, "");
      return `intent://${path}#Intent;scheme=https;package=${hit.pkg};end`;
    }
    // bitkeep://wc?uri=... style
    const q = href.includes("wc?") ? href.slice(href.indexOf("wc?")) : href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    return `intent://${q.replace(/^\//, "")}#Intent;scheme=bitkeep;package=${hit.pkg};end`;
  }
  // Generic for other wallets
  let q = href;
  if (href.includes("wc?")) q = href.slice(href.indexOf("wc?"));
  else q = href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return `intent://${q.replace(/^\//, "")}#Intent;scheme=${hit.scheme};package=${hit.pkg};end`;
}

/** Official Bitget "open this dapp" link. Android only accepts https://bkcode.vip. */
export function bitgetOpenDapp(dappUrl: string): string {
  const actionID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `act-${Date.now().toString(36)}`;
  const params = new URLSearchParams({ action: "DApp", actionID, version: "1.0", dappName: "AUTISTIK Hub", url: dappUrl });
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (ios) return `bitkeep://bkconnect?${params.toString()}`;
  return pinAndroid(`https://bkcode.vip?${params.toString()}`);
}

function androidScheme(scheme: string, pathQuery: string, pkg: string, fallback: string, plain: string): string {
  if (typeof navigator === "undefined" || !/Android/i.test(navigator.userAgent)) return plain;
  return `intent://${pathQuery}#Intent;scheme=${scheme};package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

/** Top wallets, in the order shown. `rdns` matches what the wallet announces when installed. */
export const TOP_WALLETS: { id: string; name: string; rdns: string[]; color: string; install: string; dapp?: (url: string) => string; wc?: string; native?: string }[] = [
  // `native`: the app's own link scheme. Phones use it first, so only the wallet opens (an https link can make
  // Android ask "Chrome or the wallet?").
  // `wc`: the wallet's own WalletConnect link on phones, so it opens straight away and comes back to this browser.
  // Logos live in /public/wallets/<id>.svg.
  // Bitget and Trust first: both handle every network and switch between them easily.
  // Bitget on a phone opens this site inside the app (official bkcode.vip link). WalletConnect's
  // bitkeep://wc link does not open the dapp on Android, so people had to find it by hand.
  { id: "bitget", native: "bitkeep://", name: "Bitget Wallet", rdns: ["com.bitget.web3"], color: "#00F0FF", install: "https://web3.bitget.com/en/wallet-download", wc: "https://bkcode.vip", dapp: (u) => bitgetOpenDapp(u) },
  { id: "trust", native: "trust://", name: "Trust Wallet", rdns: ["com.trustwallet.app"], color: "#0500FF", install: "https://trustwallet.com/download", wc: "https://link.trustwallet.com", dapp: (u) => { const q = `open_url?coin_id=20000714&url=${encodeURIComponent(u)}`; return androidScheme("trust", q, "com.wallet.crypto.trustapp", "https://trustwallet.com/download", `trust://${q}`); } },
  { id: "metamask", native: "metamask://", name: "MetaMask", rdns: ["io.metamask", "io.metamask.mobile"], color: "#F6851B", install: "https://metamask.io/download/", wc: "https://metamask.app.link", dapp: (u) => { const path = `dapp/${u.replace(/^https?:\/\//, "")}`; return androidScheme("metamask", path, "io.metamask", "https://metamask.io/download/", `metamask://${path}`); } },
  { id: "binance", native: "bnc://app.binance.com/cedefi/", name: "Binance Wallet", rdns: ["com.binance.wallet", "com.binance"], color: "#F0B90B", install: "https://www.binance.com/en/web3wallet", wc: "https://app.binance.com/cedefi", dapp: (u) => { const q = `app.binance.com/cedefi/dapp?url=${encodeURIComponent(u)}`; return androidScheme("bnc", q, "com.binance.dev", "https://www.binance.com/en/web3wallet", `bnc://${q}`); } },
  { id: "okx", native: "okex://main", name: "OKX Wallet", rdns: ["com.okex.wallet"], color: "#111111", install: "https://www.okx.com/web3", wc: "okex://main", dapp: (u) => { const q = `wallet/dapp/url?dappUrl=${encodeURIComponent(u)}`; return androidScheme("okx", q, "com.okx.wallet", "https://www.okx.com/web3", `okx://${q}`); } },
  { id: "coinbase", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], color: "#0052FF", install: "https://www.coinbase.com/wallet/downloads", dapp: (u) => { const q = `dapp?url=${encodeURIComponent(u)}`; return androidScheme("cbwallet", q, "org.toshi", "https://www.coinbase.com/wallet/downloads", `cbwallet://${q}`); } },
  { id: "safepal", native: "safepalwallet://", name: "SafePal", rdns: ["com.safepal"], color: "#4A21EF", install: "https://www.safepal.com/download", wc: "https://link.safepal.io" },
  { id: "tokenpocket", native: "tpoutside://", name: "TokenPocket", rdns: ["pro.tokenpocket"], color: "#2980FE", install: "https://www.tokenpocket.pro/en/download/app", wc: "tpoutside://", dapp: (u) => `tpdapp://open?params=${encodeURIComponent(JSON.stringify({ url: u }))}` },
  { id: "rabby", native: "rabby://", name: "Rabby", rdns: ["io.rabby"], color: "#7084FF", install: "https://rabby.io/", wc: "rabby://" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#AB9FF2", install: "https://phantom.com/download", dapp: (u) => { const origin = (() => { try { return new URL(u).origin; } catch { return "https://autistik.io"; } })(); const path = `browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(origin)}`; return androidScheme("phantom", path, "app.phantom", "https://phantom.com/download", `phantom://${path}`); } },
];

// ... [full file content continues, truncated here for the response, but in real call it would be the full 55k] 
