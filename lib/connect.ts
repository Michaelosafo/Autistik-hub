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
 * Android Play packages. A wrong id makes the intent miss the installed app and fall through to the store.
 * Schemes checked against each wallet's docs (Nov 2026): Bitget bitkeep://bkconnect, Trust trust://,
 * MetaMask metamask://, OKX okxwallet:// (Play id com.okx.wallet), Binance bnc:// on com.binance.dev,
 * Coinbase cbwallet:// on org.toshi, Phantom phantom:// and https://phantom.com/ul, Solflare solflare://ul,
 * Backpack https://backpack.app/ul only (no custom scheme in their docs), SafePal, TokenPocket, Rabby.
 */
const ONE_APP: { test: RegExp; scheme: string; pkg: string; keepHost?: boolean; httpsPin?: boolean }[] = [
  { test: /bitkeep:|bkcode\.vip/i, scheme: "bitkeep", pkg: "com.bitkeep.wallet" },
  { test: /trust:|link\.trustwallet\.com/i, scheme: "trust", pkg: "com.wallet.crypto.trustapp" },
  { test: /metamask:|metamask\.app\.link|link\.metamask\.io/i, scheme: "metamask", pkg: "io.metamask" },
  { test: /okxwallet:|okex:|okx:|web3\.okx\.com|www\.okx\.com/i, scheme: "okxwallet", pkg: "com.okx.wallet" },
  { test: /bnc:|app\.binance\.com/i, scheme: "bnc", pkg: "com.binance.dev", keepHost: true },
  { test: /cbwallet:|go\.cb-w\.com/i, scheme: "cbwallet", pkg: "org.toshi" },
  { test: /phantom:|phantom\.(app|com)/i, scheme: "phantom", pkg: "app.phantom" },
  { test: /solflare/i, scheme: "solflare", pkg: "com.solflare.mobile" },
  // Backpack's docs only publish the https universal link. Pin that host to the Play package (no BROWSABLE).
  { test: /backpack\.app|backpack:/i, scheme: "https", pkg: "app.backpack.mobile", httpsPin: true },
  { test: /safepal/i, scheme: "safepalwallet", pkg: "io.safepal.wallet" },
  { test: /tokenpocket|tpoutside:|tpdapp:/i, scheme: "tpoutside", pkg: "vip.mytokenpocket" },
  { test: /rabby/i, scheme: "rabby", pkg: "com.debank.rabbymobile" },
];

const androidUa = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/** Plain custom-scheme link. Chrome does not register these, so it is not offered in "Choose activity". */
function nativeUrl(scheme: string, path: string): string {
  const p = path.replace(/^\//, "");
  return p ? `${scheme}://${p}` : `${scheme}://`;
}

/**
 * Package-pinned intent for the rare wallet whose docs only publish an https link (Backpack).
 * No S.browser_fallback_url and no CATEGORY_BROWSABLE. Chrome loads that https fallback when it will not
 * launch the app (a hidden anchor click is not a user gesture), and Bitget's in-app browser also handles
 * https, which is the "Chrome or Bitget Wallet" sheet.
 */
export function androidIntent(path: string, scheme: string, pkg: string): string {
  return `intent://${path.replace(/^\//, "")}#Intent;scheme=${scheme};package=${pkg};end`;
}

/** iOS and desktop keep `plain`. Android uses the wallet's own scheme, not an https link. */
function platformLink(plain: string, android: { path: string; scheme: string; pkg: string }): string {
  if (!androidUa()) return plain;
  if (android.scheme === "https") return androidIntent(android.path, android.scheme, android.pkg);
  return nativeUrl(android.scheme, android.path);
}

/**
 * Android: open that one wallet app. https app links (bkcode.vip, link.trustwallet.com, metamask.app.link, …)
 * are rewritten onto the wallet's own scheme when it has one. The full path is kept (Binance's host is part of
 * the bnc:// link). An unknown wallet with a Play package is pinned as an https intent without BROWSABLE.
 */
export function pinAndroid(href: string, pkgOverride?: string): string {
  if (!androidUa() || /^intent:/i.test(href)) return href;
  const hit = ONE_APP.find((a) => a.test.test(href));
  const pkg = pkgOverride || hit?.pkg;
  if (!pkg) return href;
  if (/bkcode\.vip/i.test(href)) {
    const q = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
    if (/\/wc\?/.test(href)) return nativeUrl("bitkeep", href.slice(href.indexOf("wc?")));
    return nativeUrl("bitkeep", q ? `bkconnect?${q}` : "bkconnect");
  }
  if (/^https?:\/\//i.test(href)) {
    let u: URL;
    try { u = new URL(href); } catch { return href; }
    if (hit?.httpsPin || !hit) return androidIntent(`${u.host}${u.pathname}${u.search}`, "https", pkg);
    let path = `${u.pathname}${u.search}`.replace(/^\//, "");
    if (hit.keepHost) path = `${u.host}${u.pathname}${u.search}`.replace(/^\//, "");
    if (hit.scheme === "cbwallet" && /\/dapp/i.test(u.pathname)) {
      const cb = u.searchParams.get("cb_url") || u.searchParams.get("url") || "";
      if (cb) path = `dapp?url=${encodeURIComponent(cb)}`;
    }
    return nativeUrl(hit.scheme, path);
  }
  const scheme = href.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1] || hit?.scheme || "https";
  return nativeUrl(scheme, href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""));
}

/**
 * Official Bitget "open this dapp" link (BKConnect).
 * iOS and Android: bitkeep://bkconnect (Bitget's Android sample). Desktop: https://bkcode.vip.
 * Android must not use intent:// with S.browser_fallback_url. Chrome will not launch an app from a
 * hidden link click, then loads that https fallback, and Bitget also handles https — the chooser.
 * https://web3.bitget.com/en/docs/configuration/deeplink
 */
/**
 * Bitget's WalletConnect request link. Bitget documents its https host (bkcode.vip) as the link Android supports;
 * bitkeep://wc?uri=… opened Bitget with "Attempted an unsupported operation". On Android the https link is pinned
 * to the Bitget app (so Chrome isn't offered); on iPhone it's the universal link, which opens Bitget.
 */
const BITGET_LINK = "https://bkcode.vip";
export function bitgetWcLink(uri: string): string {
  const path = `bkcode.vip/wc?uri=${encodeURIComponent(uri)}`;
  return androidUa() ? androidIntent(path, "https", "com.bitkeep.wallet") : `https://${path}`;
}

export function bitgetOpenDapp(dappUrl: string, net?: string): string {
  // Bitget's documented "pick this network" flag on the page link (_needChain): eth, bnb. With it, Bitget opens the
  // page on the right network and doesn't ask which network to use.
  let url = dappUrl;
  const need = net === "ethereum" ? "eth" : net === "bsc" ? "bnb" : "";
  if (need) { try { const u = new URL(dappUrl); u.searchParams.set("_needChain", need); url = u.toString(); } catch { /* keep as is */ } }
  // Only the documented parameters (action, url, version): extra ones made Bitget say "unsupported operation".
  const query = new URLSearchParams({ action: "dapp", url, version: "1" }).toString();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  // Android: Bitget's own scheme opens only Bitget (an https link also offers Chrome). iOS and computers: the
  // documented https link, which opens the Bitget app when it's installed.
  if (/Android/i.test(ua)) return `bitkeep://bkconnect?${query}`;
  return `https://bkcode.vip?${query}`;
}

/** True inside a wallet's own browser. A deep link from there must not run; the injected provider is used instead. */
export function insideWallet(id: string): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  const eth = w.ethereum;
  const ua = navigator.userAgent || "";
  switch (id) {
    case "bitget": return !!(w.bitkeep || w.bitget || eth?.isBitKeep || eth?.isBitgetWallet) || /BitKeep|BitgetWallet/i.test(ua);
    case "trust": return !!w.trustwallet || /TrustWallet/i.test(ua);
    case "metamask": return /MetaMaskMobile/i.test(ua);
    case "okx": return !!w.okxwallet || /OKApp|OKXWallet/i.test(ua);
    case "binance": return !!(w.binancew3w || w.BinanceChain) || /BinanceWeb3|BNC\//i.test(ua);
    case "coinbase": return !!w.coinbaseWalletExtension || /CoinbaseWallet/i.test(ua);
    case "phantom": return !!w.phantom || /\bPhantom\b/i.test(ua);
    case "solflare": return !!w.solflare || /\bSolflare\b/i.test(ua);
    case "backpack": return !!w.backpack || /\bBackpack\b/i.test(ua);
    case "safepal": return !!w.safepalProvider || /\bSafePal\b/i.test(ua);
    case "tokenpocket": return !!eth?.isTokenPocket || /TokenPocket/i.test(ua);
    case "rabby": return !!eth?.isRabby || /RabbyMobile/i.test(ua);
    default: return false;
  }
}

/** True inside Bitget's own browser, where window.bitkeep is already injected and a deep link must not run. */
export function insideBitget(): boolean {
  return insideWallet("bitget");
}

const refOf = (u: string) => { try { return new URL(u).origin; } catch { return "https://autistik.io"; } };
/** https://<host>/<path>/<encoded url>?ref=<origin>, and on Android the wallet's own scheme (or a package-pinned https intent). */
function browseLink(hostPath: string, url: string, android: { scheme: string; pkg: string; path: string }): string {
  const enc = encodeURIComponent(url);
  const ref = encodeURIComponent(refOf(url));
  const plain = `https://${hostPath}/${enc}?ref=${ref}`;
  return platformLink(plain, { path: `${android.path}/${enc}?ref=${ref}`, scheme: android.scheme, pkg: android.pkg });
}

/** Top wallets, in the order shown. `rdns` matches what the wallet announces when installed. */
export const TOP_WALLETS: { id: string; name: string; rdns: string[]; color: string; install: string; dapp?: (url: string) => string; wc?: string; native?: string }[] = [
  // `native`: the app's own link scheme. Phones use it first, so only the wallet opens (an https link can make
  // Android ask "Chrome or the wallet?").
  // `wc`: the wallet's own WalletConnect link on phones, so it opens straight away and comes back to this browser.
  // Logos live in /public/wallets/<id>.svg.
  // Bitget and Trust first: both handle every network and switch between them easily.
  // Bitget on a phone opens this site inside the app via bitkeep://bkconnect (Android: package-pinned intent).
  // An https://bkcode.vip link is also handled by Chrome, so Android shows "Choose activity".
  { id: "bitget", native: "bitkeep://", name: "Bitget Wallet", rdns: ["com.bitget.web3"], color: "#00F0FF", install: "https://web3.bitget.com/en/wallet-download", wc: "https://bkcode.vip", dapp: (u) => bitgetOpenDapp(u) },
  { id: "trust", native: "trust://", name: "Trust Wallet", rdns: ["com.trustwallet.app"], color: "#0500FF", install: "https://trustwallet.com/download", wc: "https://link.trustwallet.com", dapp: (u) => { const q = `open_url?coin_id=20000714&url=${encodeURIComponent(u)}`; return platformLink(`https://link.trustwallet.com/${q}`, { path: q, scheme: "trust", pkg: "com.wallet.crypto.trustapp" }); } },
  { id: "metamask", native: "metamask://", name: "MetaMask", rdns: ["io.metamask", "io.metamask.mobile"], color: "#F6851B", install: "https://metamask.io/download/", wc: "https://metamask.app.link", dapp: (u) => { const path = `dapp/${u.replace(/^https?:\/\//, "")}`; return platformLink(`https://link.metamask.io/${path}`, { path, scheme: "metamask", pkg: "io.metamask" }); } },
  { id: "binance", native: "bnc://app.binance.com/cedefi/", name: "Binance Wallet", rdns: ["com.binance.wallet", "com.binance"], color: "#F0B90B", install: "https://www.binance.com/en/web3wallet", wc: "https://app.binance.com/cedefi", dapp: (u) => { const q = `app.binance.com/cedefi/dapp?url=${encodeURIComponent(u)}`; return platformLink(`https://${q}`, { path: q, scheme: "bnc", pkg: "com.binance.dev" }); } },
  { id: "okx", native: "okxwallet://main", name: "OKX Wallet", rdns: ["com.okex.wallet"], color: "#111111", install: "https://www.okx.com/web3", wc: "okxwallet://main", dapp: (u) => { const q = `wallet/dapp/url?dappUrl=${encodeURIComponent(u)}`; return platformLink(`okx://${q}`, { path: q, scheme: "okx", pkg: "com.okx.wallet" }); } },
  { id: "coinbase", native: "cbwallet://", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], color: "#0052FF", install: "https://www.coinbase.com/wallet/downloads", wc: "https://go.cb-w.com", dapp: (u) => { const q = `dapp?url=${encodeURIComponent(u)}`; return platformLink(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}`, { path: q, scheme: "cbwallet", pkg: "org.toshi" }); } },
  { id: "safepal", native: "safepalwallet://", name: "SafePal", rdns: ["com.safepal"], color: "#4A21EF", install: "https://www.safepal.com/download", wc: "https://link.safepal.io" },
  { id: "tokenpocket", native: "tpoutside://", name: "TokenPocket", rdns: ["pro.tokenpocket"], color: "#2980FE", install: "https://www.tokenpocket.pro/en/download/app", wc: "tpoutside://", dapp: (u) => { const plain = `tpdapp://open?params=${encodeURIComponent(JSON.stringify({ url: u }))}`; return platformLink(plain, { path: plain.replace(/^tpdapp:\/\//, ""), scheme: "tpdapp", pkg: "vip.mytokenpocket" }); } },
  { id: "rabby", native: "rabby://", name: "Rabby", rdns: ["io.rabby"], color: "#7084FF", install: "https://rabby.io/", wc: "rabby://" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#AB9FF2", install: "https://phantom.com/download", dapp: (u) => browseLink("phantom.com/ul/browse", u, { scheme: "phantom", pkg: "app.phantom", path: "ul/browse" }) },
];

/** WalletConnect explorer ids, so these show first in the WalletConnect list. */
const WC_FEATURED = [
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4", // Binance Web3 Wallet
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
  "38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662", // Bitget Wallet
  "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa", // Coinbase Wallet
];

export const WALLETCONNECT_ID = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim();

// ---------------------------------------------------------------- networks

/**
 * Every network people can pick before (or after) connecting: all the networks the Hub's swap supports
 * (lib/bridge-chains.ts). EVM ones switch the wallet (adding the network if the wallet doesn't know it);
 * Solana uses Solana wallets.
 */
export type NetKey = string;
export type Net = { key: string; id: number; name: string; short: string; chainId?: number; color: string; add?: object };
export const NETWORKS: Net[] = XCHAIN_LIST.map((c) => ({
  key: c.key, id: c.id, name: c.name, short: c.name.split(" ")[0].slice(0, 8), color: c.color,
  ...(c.kind === "evm" ? {
    chainId: c.id,
    add: { chainName: c.name, nativeCurrency: { name: c.native.symbol, symbol: c.native.symbol, decimals: c.native.decimals }, rpcUrls: [c.rpc], blockExplorerUrls: c.explorer ? [c.explorer] : [] },
  } : {}),
}));
// Robinhood Chain (an Arbitrum chain, chain ID 4663): in the network menu for the Launch Pad, Instant launch and the
// AUTISTIK Locker there. Not in the cross-network swap list (lib/bridge-chains.ts), since LI.FI doesn't route to it.
if (!NETWORKS.some((n) => n.key === "robinhood")) {
  NETWORKS.push({
    key: "robinhood", id: 4663, chainId: 4663, name: "Robinhood Chain", short: "Robinhood", color: "#00C805",
    add: { chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] },
  });
}
/** Network logos (from LI.FI, through the Hub), loaded once per visit. Missing ones show a coloured dot. */
let logoReq: Promise<Record<number, string>> | null = null;
export const netLogos = () => (logoReq ??= fetch("/api/wallet/x-chains", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  .then((r) => r.json()).then((d) => (d?.logos && typeof d.logos === "object" ? d.logos : {})).catch(() => ({})));
/** The ones shown first. */
export const TOP_NETWORKS = ["bsc", "ethereum", "solana", "robinhood", "base", "arbitrum"];
export const netOf = (k: NetKey) => NETWORKS.find((n) => n.key === k) ?? NETWORKS[0];
const savedNet = (): NetKey => {
  try { const v = localStorage.getItem("aw-network"); if (NETWORKS.some((n) => n.key === v)) return v as NetKey; } catch { /* private mode */ }
  return "bsc";
};

// ---------------------------------------------------------------- state shared with the sheet

export type SolConn = { name: string; wallet: Wallet; account: WalletAccount };
type State = {
  open: boolean; detected: Detected[]; current: { name: string; provider: any } | null; error: string; busy: string;
  /** The network picked in the top bar or the Connect window. */
  network: NetKey;
  /** Solana wallets on this device (Phantom, Solflare, Backpack…), and the one connected. */
  solFound: Wallet[]; sol: SolConn | null;
  /** A WalletConnect code for one wallet, shown in our own window: scan it with that wallet's app. */
  qr: { uri: string; name: string; logo: string; install?: string; href?: string } | null;
  /** A request waiting for the member to approve it in their wallet (shown as a bar with an "Open wallet" button). */
  pending: { name: string; what: string; href?: string; since: number; mobileWc: boolean } | null;
};
let state: State = { open: false, detected: [], current: null, error: "", busy: "", network: "bsc", solFound: [], sol: null, qr: null, pending: null };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getState = () => state;

let resolver: ((p: any) => void) | null = null;
let started = false;

/** Listens for wallets announcing themselves (EIP-6963) and asks them to announce. Safe to call many times. */
export function startDiscovery() {
  if (started || typeof window === "undefined") return;
  started = true;
  set({ network: savedNet() });
  // Solana wallets (Wallet Standard): the ones here now, and any that load a moment later.
  try {
    const ws = getWallets();
    const refresh = () => set({ solFound: ws.get().filter(isSolWallet) });
    refresh(); ws.on("register", refresh);
  } catch { /* old browsers */ }
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const d = e?.detail as Detected | undefined;
    if (!d?.info?.uuid || !d.provider) return;
    if (state.detected.some((x) => x.info.uuid === d.info.uuid)) return;
    set({ detected: [...state.detected, { info: { uuid: String(d.info.uuid), name: String(d.info.name).slice(0, 40), icon: String(d.info.icon || ""), rdns: String(d.info.rdns || "") }, provider: d.provider }] });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Back from the wallet app: if it approved while this tab was in the background, use that connection now.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.current) return;
    if (wc?.session) { choose("WalletConnect", wc); return; }
    if (wcFlagAge() < 15 * 60_000) restoreWallet().catch(() => {});
  });
}

/** The plain injected wallet, for wallet apps' own browsers that don't announce themselves. */
export function legacyInjected(): any | null {
  if (typeof window === "undefined") return null;
  const eth = (window as any).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
}

const isEip1193 = (p: any) => !!p && typeof p.request === "function";
/**
 * A popular wallet already in this browser (its extension, or its own app's browser on a phone), found by the
 * names wallets put on the page. Used so tapping "Bitget Wallet" connects right here instead of opening the app.
 */
export function injectedFor(id: string): any | null {
  if (typeof window === "undefined") return null;
  const w = window as any, eth = w.ethereum;
  const list: any[] = [eth, ...(Array.isArray(eth?.providers) ? eth.providers : [])].filter(isEip1193);
  const flag = (f: (p: any) => boolean) => list.find(f) ?? null;
  switch (id) {
    case "bitget": {
      const named = [w.bitkeep?.ethereum, w.bitget?.ethereum].find(isEip1193) ?? flag((p) => p.isBitKeep || p.isBitgetWallet);
      if (named) return named;
      // Bitget's in-app browser sometimes only exposes window.ethereum. Stay on it; don't deep-link.
      if (/BitKeep|BitgetWallet/i.test(navigator.userAgent || "") && isEip1193(eth)) return eth;
      return null;
    }
    case "trust": return [w.trustwallet?.ethereum, w.trustwallet].find(isEip1193) ?? flag((p) => p.isTrust || p.isTrustWallet);
    case "okx": return [w.okxwallet].find(isEip1193) ?? flag((p) => p.isOkxWallet || p.isOKExWallet);
    case "binance": return [w.binancew3w?.ethereum, w.BinanceChain].find(isEip1193) ?? flag((p) => p.isBinance);
    case "coinbase": return [w.coinbaseWalletExtension].find(isEip1193) ?? flag((p) => p.isCoinbaseWallet);
    case "safepal": return [w.safepalProvider].find(isEip1193) ?? flag((p) => p.isSafePal);
    case "tokenpocket": return flag((p) => p.isTokenPocket);
    case "rabby": return flag((p) => p.isRabby);
    case "phantom": return [w.phantom?.ethereum].find(isEip1193);
    case "metamask": return flag((p) => p.isMetaMask && !p.isBitKeep && !p.isTrust && !p.isTrustWallet && !p.isOkxWallet && !p.isRabby && !p.isTokenPocket && !p.isSafePal && !p.isCoinbaseWallet && !p.isPhantom);
    default: return null;
  }
}

/** The same for Solana: the wallet's own Solana object on the page (older wallets that don't use Wallet Standard). */
export function injectedSolFor(id: string): any | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const ok = (p: any) => !!p && typeof p.connect === "function" && typeof p.signTransaction === "function";
  const pick: Record<string, any[]> = {
    bitget: [w.bitkeep?.solana, w.bitget?.solana], trust: [w.trustwallet?.solana], phantom: [w.phantom?.solana, w.solana?.isPhantom ? w.solana : null],
    solflare: [w.solflare], okx: [w.okxwallet?.solana], backpack: [w.backpack?.solana, w.backpack], coinbase: [w.coinbaseSolana],
  };
  return (pick[id] || []).find(ok) ?? null;
}

/** Wraps an older Solana wallet object so it works like a Wallet Standard wallet. */
function legacySolWallet(name: string, icon: string, p: any): Wallet {
  return {
    version: "1.0.0", name, icon: icon as any, chains: ["solana:mainnet"], accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async (opts?: { silent?: boolean }) => {
          const r = await p.connect(opts?.silent ? { onlyIfTrusted: true } : undefined);
          const pk = (r?.publicKey || p.publicKey)?.toString();
          if (!pk) throw new Error("The wallet didn't share an account.");
          return { accounts: [{ address: pk, publicKey: new Uint8Array(), chains: ["solana:mainnet"], features: ["solana:signTransaction"] }] };
        },
      },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { await p.disconnect?.(); } },
      "solana:signTransaction": {
        version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          const { VersionedTransaction } = await import("@solana/web3.js");
          const signed = await p.signTransaction(VersionedTransaction.deserialize(transaction));
          return [{ signedTransaction: signed.serialize() }];
        },
      },
    } as any,
  } as Wallet;
}

/** Connects a popular wallet's Solana side that's already in this browser. */
export function chooseSolInjected(id: string, name: string, icon: string): boolean {
  const p = injectedSolFor(id);
  if (!p) return false;
  chooseSol(legacySolWallet(name, icon, p));
  return true;
}

/** The wallet chosen in this tab (if any), without asking. */
export const currentWallet = () => state.current;

/** Opens the sheet (unless a wallet is already chosen) and resolves with its provider, or null if closed. */
export function pickWallet(opts: { fresh?: boolean } = {}): Promise<any | null> {
  startDiscovery();
  if (state.current && !opts.fresh) return Promise.resolve(state.current.provider);
  resolver?.(null);
  set({ open: true, error: "", busy: "" });
  return new Promise((res) => { resolver = res; });
}

export function closePicker() {
  if (state.qr) cancelQr();
  set({ open: false, busy: "" });
  resolver?.(null); resolver = null;
}

let watched: any = null;
/** Keeps the network button in step when the member switches network inside their wallet. */
function watchChain(provider: any) {
  if (watched === provider) return;
  watched = provider;
  const on = (hex: string) => { const n = NETWORKS.find((x) => x.chainId === parseInt(String(hex), 16)); if (n && state.network !== "solana") rememberNet(n.key); };
  provider.request?.({ method: "eth_chainId" }).then(on).catch(() => {});
  provider.on?.("chainChanged", on);
}
const rememberNet = (k: NetKey) => { set({ network: k }); try { localStorage.setItem("aw-network", k); } catch { /* private mode */ } };

/** Asks the wallet to move to a network (adding it first if the wallet doesn't know it). */
export async function switchEvm(provider: any, chainId: number) {
  const hex = "0x" + chainId.toString(16);
  try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
  catch (e: any) {
    const add = NETWORKS.find((n) => n.chainId === chainId)?.add;
    if (!add || (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String(e?.message)))) throw e;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, ...add }] });
  }
}

/**
 * Picks the network. EVM: the connected wallet is asked to switch to it. Solana: opens the Connect window on Solana
 * wallets if none is connected yet.
 */
export async function setNetwork(k: NetKey) {
  rememberNet(k);
  const n = netOf(k);
  if (n.chainId && state.current) {
    try { await switchEvm(state.current.provider, n.chainId); }
    catch (e: any) { set({ error: /reject|denied|cancel/i.test(String(e?.message)) ? "You stayed on the old network in your wallet." : "Switch the network inside your wallet app." }); }
  }
}

// ---- Approvals: make sure the member always knows where to approve, and can get there in one tap.
const APPROVE: Record<string, string> = {
  eth_sendTransaction: "the transaction", eth_signTransaction: "the transaction", personal_sign: "the signature", eth_sign: "the signature",
  eth_signTypedData: "the signature", eth_signTypedData_v3: "the signature", eth_signTypedData_v4: "the signature",
  wallet_switchEthereumChain: "the network switch", wallet_addEthereumChain: "adding the network", wallet_watchAsset: "adding the token",
  eth_requestAccounts: "the connection",
};
/** The link that brings a WalletConnect wallet app to the front for a request (the wallet picked when connecting). */
function wcRequestHref(id?: number): string | undefined {
  try {
    const c = JSON.parse(localStorage.getItem("WALLETCONNECT_DEEPLINK_CHOICE") || "null");
    const base = String(c?.href || "");
    if (!base) return undefined;
    const topic = wc?.session?.topic ? `sessionTopic=${encodeURIComponent(wc.session.topic)}` : "";
    const q = [id ? `requestId=${id}` : "", topic].filter(Boolean).join("&");
    const built = base.includes("://") && !/^https?:/.test(base)
      ? `${base.endsWith("/") || base.endsWith("://") ? base : base + "/"}wc${q ? "?" + q : ""}`
      : `${base.replace(/\/$/, "")}/wc${q ? "?" + q : ""}`;
    return pinAndroid(built);
  } catch { return undefined; }
}
const wcWalletName = () => { try { return String(JSON.parse(localStorage.getItem("WALLETCONNECT_DEEPLINK_CHOICE") || "null")?.name || "") || "your wallet"; } catch { return "your wallet"; } };

/** Wraps the wallet's request() once, so every approval shows the "Approve in <wallet>" bar until it's answered. */
function watchRequests(name: string, provider: any) {
  if (!provider || provider.__awWatched || typeof provider.request !== "function") return;
  provider.__awWatched = true;
  const orig = provider.request.bind(provider);
  provider.request = async (args: any) => {
    const what = APPROVE[args?.method];
    if (!what) return orig(args);
    const phone = isMobile();
    const isWc = provider === wc;
    const label = isWc ? wcWalletName() : name;
    const href = phone ? wcRequestHref() : undefined;
    const mine = { name: label, what, href, since: Date.now(), mobileWc: phone };
    // Every approval (swap, liquidity, a buy) shows the same bar at once, on every page.
    const show = () => set({ pending: mine });
    show();
    if (phone && href) setTimeout(() => openWalletApp(href), 300);
    try { return await orig(args); }
    catch (e: any) {
      if (e?.code === -32002 || /already pending/i.test(String(e?.message))) {
        throw Object.assign(new Error(`${label} already has a request waiting. Open ${label}, answer that request first, then try again here.`), { code: -32002 });
      }
      throw e;
    } finally {
      if (state.pending === mine) set({ pending: null });
    }
  };
}
export const dismissPending = () => set({ pending: null });

function choose(name: string, provider: any) {
  if (name === "WalletConnect") flagWc(true);
  watchChain(provider);
  watchRequests(name, provider);
  set({ current: { name, provider }, open: false, busy: "", error: "", qr: null });
  try { sessionStorage.setItem("aw-wallet", name); localStorage.setItem("aw-last-wallet", name); } catch { /* private mode */ }
  resolver?.(provider); resolver = null;
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: name })); } catch { /* old browsers */ }
}

/** Use a wallet that's installed in this browser. */
export async function chooseInjected(name: string, provider: any) {
  set({ busy: name, error: "" });
  watchRequests(name, provider);
  try {
    await provider.request({ method: "eth_requestAccounts" });
    const id = netOf(state.network).chainId;
    if (id) await switchEvm(provider, id).catch(() => { /* they can switch later from the network button */ });
    choose(name, provider);
  } catch (e: any) {
    // Inside Bitget's browser with a Solana-only wallet picked in Bitget: it can't give a BNB / EVM account, and
    // Bitget shows "This wallet does not support BNB Chain" every time. Move this site to Solana so it stops asking.
    if (insideWallet("bitget") && injectedSolFor("bitget") && e?.code !== -32002) {
      rememberNet("solana");
      try { sessionStorage.removeItem("aw-wallet"); } catch { /* private mode */ }
      set({ busy: "", error: "The wallet picked in Bitget has no BNB Chain account, so this site switched to Solana. For BNB, tap the wallet name at the top of Bitget and pick a multi-chain wallet, then connect again." });
      return;
    }
    set({ busy: "", error: e?.code === -32002 ? String(e.message) : /reject|denied|cancel/i.test(String(e?.message)) ? "You cancelled in the wallet." : String(e?.message || e).slice(0, 200) });
  }
}

let wc: any = null;
// Kept in localStorage (not just this tab): phones often reload the page, or open a new tab, when coming back
// from the wallet app, and the WalletConnect session must survive that.
const WC_FLAG = "aw-wc";
const flagWc = (on: boolean) => { try { on ? localStorage.setItem(WC_FLAG, String(Date.now())) : localStorage.removeItem(WC_FLAG); } catch { /* private mode */ } };
// Set when a connection starts; a connection that never finished is forgotten after 15 minutes.
const wcFlagAge = () => { try { const t = Number(localStorage.getItem(WC_FLAG)); return t ? Date.now() - t : Infinity; } catch { return Infinity; } };

let wcChain = 0;
const WC_CHAINS = [56, 1, 8453, 42161, 10, 137, 43114, 59144, 324];
async function initWc(chainId = netOf(state.network).chainId || 56) {
  // A new network before connecting: start a fresh WalletConnect with that network required.
  if (wc && !wc.session && wcChain !== chainId) { pre = null; try { await wc.disconnect(); } catch { /* not connected */ } wc = null; }
  if (wc) return wc;
  wcChain = chainId;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wc = await EthereumProvider.init({
    projectId: WALLETCONNECT_ID,
    // Our own storage space, so this connection never mixes with the built-in wallet's WalletConnect (Privy) or the
    // Solana one below: sharing it made pairing fail ("No matching key").
    customStoragePrefix: "autistik-evm",
    // The network picked is the one required network: Trust Wallet and several others refuse a connection that
    // names no required network at all. Every other network stays optional, so nothing else needs approving up front.
    chains: [chainId],
    rpcMap: Object.fromEntries(NETWORKS.filter((n) => n.chainId).map((n) => [n.chainId!, (n.add as any).rpcUrls[0]])),
    // Only networks nearly every wallet knows: a long list makes some wallets (Trust among them) refuse the
    // connection. Any other network is added to the wallet when the member switches to it.
    optionalChains: [...new Set([chainId, ...WC_CHAINS])] as [number, ...number[]],
    showQrModal: true,
    qrModalOptions: { themeMode: "dark", explorerRecommendedWalletIds: WC_FEATURED } as any,
    metadata: {
      name: "AUTISTIK Hub", description: "Autism community, wallet and launch pad", url: location.origin, icons: [`${location.origin}/icons/icon-512.png`, `${location.origin}/icon.svg`],
      // Where the wallet app sends the member back after they approve: this page, in their browser.
      redirect: { native: location.origin + location.pathname, universal: location.origin + location.pathname },
    } as any,
  } as any);
  wc.on("disconnect", () => { flagWc(false); if (state.current?.provider === wc) set({ current: null }); });
  // The wallet approved while this page was in the background (or reloaded): pick the session up.
  wc.on("connect", () => { if (!state.current && wc.session) choose("WalletConnect", wc); });
  return wc;
}

/**
 * WalletConnect: a QR code on a computer; on a phone, a list of wallet apps that opens the one picked.
 * With `walletId` (a top wallet with its own link) on a phone, that wallet's app opens directly.
 */
/** A wallet to connect through WalletConnect: its app link on phones, and its logo for our own code window. */
export type WcTarget = { name: string; logo: string; wc?: string; native?: string; install?: string; pkg?: string };

/** The wallet app's WalletConnect link (same rules as WalletConnect's own list). On Android the link is package-pinned. */
export function wcHref(base: string, uri: string, pkg?: string) {
  const u = encodeURIComponent(uri);
  const built = base.includes("://") && !/^https?:/.test(base)
    ? `${base.endsWith("://") || base.endsWith("/") ? base : base + "/"}wc?uri=${u}`
    : `${base.replace(/\/$/, "")}/wc?uri=${u}`;
  return pinAndroid(built, pkg);
}

// ---- Phones: the WalletConnect link is made BEFORE the tap.
// Phones only let a page open another app (the wallet) straight from a tap. Making the link takes a second or two
// over the network, so opening the wallet after that was often blocked and nothing happened. Now the link is made
// in the background as soon as the Connect window opens, and tapping a wallet opens it within the tap itself.
let pre: { uri: string; at: number; wc: any } | null = null;
let preparing = false;
const PRE_FRESH = 4 * 60_000; // WalletConnect links last 5 minutes
const preReady = () => !!pre && pre.wc === wc && !!wc && !wc.session && Date.now() - pre.at < PRE_FRESH;

export async function prepareMobileWc() {
  if (!isMobile() || !WALLETCONNECT_ID || state.current || state.network === "solana" || preparing || preReady()) return;
  preparing = true;
  try {
    // A stale link: start over with a fresh provider.
    if (pre && !preReady() && wc && !wc.session) { const old = wc; wc = null; pre = null; old.disconnect?.().catch(() => {}); }
    const p = await initWc();
    if (p.session) return;
    p.rpc.showQrModal = false;
    const uri = await new Promise<string>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 15_000);
      p.once("display_uri", (u: string) => { clearTimeout(t); res(u); });
      p.connect().then(async () => {
        // Approved in the wallet app.
        const id = netOf(state.network).chainId;
        if (id) await switchEvm(p, id).catch(() => {});
        if (!state.current) choose("WalletConnect", p);
      }).catch(() => { if (pre?.wc === p) pre = null; if (state.busy) set({ busy: "" }); });
    });
    if (wc === p) pre = { uri, at: Date.now(), wc: p };
  } catch { pre = null; } finally { preparing = false; }
}

export const isAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Android: hands the WalletConnect link to the phone itself, which shows its own list of the wallet apps installed
 * (Trust, MetaMask, Bitget, Binance, OKX…). The member picks one, approves, and comes back here connected.
 * Must run inside the tap, so it uses the link made in the background when the Connect window opened.
 */
export async function choosePhoneWallets() {
  if (!WALLETCONNECT_ID) { set({ error: "WalletConnect isn't switched on yet. Open this site inside your wallet app's browser instead." }); return; }
  const go = () => {
    const uri = pre!.uri;
    try { localStorage.removeItem("WALLETCONNECT_DEEPLINK_CHOICE"); } catch { /* private mode */ }
    flagWc(true);
    set({ open: true, busy: "", error: "", qr: { uri, name: "your wallet", logo: "/wallets/walletconnect.svg", href: uri } });
    try { location.href = uri; } catch { /* the "Open" button is there */ }
  };
  if (preReady()) { go(); return; }
  set({ busy: "your wallet", error: "" });
  if (!preparing) prepareMobileWc().catch(() => {});
  for (let i = 0; i < 60 && !preReady(); i++) await new Promise((r) => setTimeout(r, 150));
  if (preReady()) go();
  else set({ busy: "", error: "Couldn't get the wallet link. Check your internet and try again, or tap your wallet below." });
}

// ---- Bitget on phones, EVM networks: built the way the Solana connection is, which Bitget handles.
// The request is made at the tap with a short list of what we ask for; the general EVM WalletConnect (prepared in
// the background, with a long list) left Bitget loading without ever showing the request.
let evmUp: any = null;
const EVM_UP_KEY = "aw-evm-up";
const EVM_METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain"];
const EVM_EVENTS = ["chainChanged", "accountsChanged"];
const rpcOf = (id: number) => (NETWORKS.find((n) => n.chainId === id)?.add as any)?.rpcUrls?.[0] as string | undefined;
async function initEvmUp() {
  if (evmUp) return evmUp;
  const { UniversalProvider } = await import("@walletconnect/universal-provider");
  evmUp = await UniversalProvider.init({
    projectId: WALLETCONNECT_ID,
    customStoragePrefix: "autistik-evm-up",
    metadata: {
      name: "AUTISTIK Hub", description: "Autism community, wallet and launch pad", url: location.origin, icons: [`${location.origin}/icons/icon-512.png`, `${location.origin}/icon.svg`],
      redirect: { native: location.origin + location.pathname, universal: location.origin + location.pathname },
    } as any,
  } as any);
  evmUp.on("session_delete", () => {
    try { localStorage.removeItem(EVM_UP_KEY); } catch { /* private mode */ }
    if (state.current?.provider?.__up === evmUp) set({ current: null });
  });
  return evmUp;
}
/** The WalletConnect session as a normal EVM wallet (request + events), like the rest of the site expects. */
function upProvider(up: any, t: WcTarget) {
  const hex = (c: any) => "0x" + Number(String(c).split(":").pop()).toString(16);
  const wrapped = new Map<any, any>();
  const p: any = {
    __up: up, isWalletConnect: true,
    get session() { return up.session; },
    request: async (args: { method: string; params?: any }) => {
      const r = await up.request(args);
      if (args.method === "wallet_switchEthereumChain") { try { up.setDefaultChain(`eip155:${parseInt(args.params?.[0]?.chainId, 16)}`); } catch { /* not in the session */ } }
      return r;
    },
    on: (e: string, f: any) => {
      const g = e === "chainChanged" ? (c: any) => f(hex(c)) : f;
      wrapped.set(f, g); up.on(e, g); return p;
    },
    removeListener: (e: string, f: any) => { const g = wrapped.get(f) || f; (up.removeListener || up.off)?.call(up, e, g); return p; },
    disconnect: () => up.disconnect(),
  };
  // Requests bring Bitget forward on the phone, like the Solana signing does. Bitget: its https link
  // (bitkeep://wc?requestId=… made it say "Attempted an unsupported operation").
  try { localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", JSON.stringify({ href: t.name === "Bitget Wallet" ? BITGET_LINK : walletBase(t), name: t.name })); } catch { /* private mode */ }
  return p;
}
async function finishEvmUp(t: WcTarget, up: any) {
  const accts: string[] = up.session?.namespaces?.eip155?.accounts || [];
  if (!accts.length) throw new Error("The wallet didn't share an account.");
  const want = netOf(state.network).chainId || 56;
  const has = accts.some((a) => a.startsWith(`eip155:${want}:`));
  try { up.setDefaultChain(`eip155:${has ? want : accts[0].split(":")[1]}`); } catch { /* keep the wallet's */ }
  try { localStorage.setItem(EVM_UP_KEY, JSON.stringify(t)); } catch { /* private mode */ }
  choose(t.name, upProvider(up, t));
}
async function chooseEvmUp(t: WcTarget) {
  // Drop a link prepared in the background for the general route, so the two don't clash.
  if (pre && wc && !wc.session) { const old = wc; wc = null; pre = null; old.disconnect?.().catch(() => {}); }
  set({ busy: t.name, error: "", qr: null });
  const id = netOf(state.network).chainId || 56;
  try {
    const up = await initEvmUp();
    if (up.session?.namespaces?.eip155?.accounts?.length) { await finishEvmUp(t, up); return; }
    up.once?.("display_uri", (uri: string) => {
      const base = walletBase(t);
      const href = t.name === "Bitget Wallet" ? bitgetWcLink(uri) : base ? wcHref(base, uri, t.pkg) : uri;
      set({ open: true, qr: { uri, name: t.name, logo: t.logo, install: t.install, href }, busy: "" });
      openWalletApp(href);
    });
    const others = [56, 1, 8453, 42161].filter((c) => c !== id);
    const rpcMap = Object.fromEntries([id, ...others].map((c) => [c, rpcOf(c)] as [number, string | undefined]).filter(([, u]) => !!u)) as Record<number, string>;
    await up.connect({
      namespaces: { eip155: { chains: [`eip155:${id}`], methods: EVM_METHODS, events: EVM_EVENTS, rpcMap } },
      optionalNamespaces: { eip155: { chains: others.map((c) => `eip155:${c}`), methods: EVM_METHODS, events: EVM_EVENTS, rpcMap } },
    });
    await finishEvmUp(t, up);
  } catch (e: any) {
    if (state.current) return;
    if (cancelled) { cancelled = false; return; }
    set({ open: true, busy: "", qr: null, error: /reset|reject|closed|cancel/i.test(String(e?.message)) ? "Closed in the wallet. Try again, or pick another wallet." : String(e?.message || e).slice(0, 160) });
  }
}
/** A Bitget EVM session from before a reload (or the trip to the wallet app). */
async function restoreEvmUp(): Promise<any | null> {
  let t: WcTarget | null = null;
  try { t = JSON.parse(localStorage.getItem(EVM_UP_KEY) || "null"); } catch { /* private mode */ }
  if (!t || !WALLETCONNECT_ID) return null;
  try {
    const up = await initEvmUp();
    if (!up.session?.namespaces?.eip155?.accounts?.length) { try { localStorage.removeItem(EVM_UP_KEY); } catch { /* private mode */ } return null; }
    if (!state.current) await finishEvmUp(t, up);
    return state.current?.provider || null;
  } catch { return null; }
}

export async function chooseWalletConnect(walletId?: string | WcTarget) {
  if (!WALLETCONNECT_ID) { set({ error: "WalletConnect isn't switched on yet. Open this site inside your wallet app's browser instead." }); return; }
  const t = typeof walletId === "object" ? walletId : TOP_WALLETS.find((w) => w.id === walletId);
  const top: WcTarget | undefined = !t ? undefined : "id" in t ? { name: t.name, logo: `/wallets/${(t as any).id}.svg`, wc: (t as any).wc, native: (t as any).native, install: (t as any).install } : t;
  // Already inside that wallet's browser: use the injected provider. Never deep-link (that reopens the chooser or loops).
  const hereId = top ? TOP_WALLETS.find((w) => w.name === top.name)?.id : undefined;
  if (isMobile() && hereId && insideWallet(hereId)) {
    const inj = injectedFor(hereId) || legacyInjected();
    if (inj) { choose(top!.name, inj); return; }
    set({ busy: "", error: `${top!.name} isn't ready in this browser yet. Wait a second and tap it again.` });
    return;
  }
  // Bitget on a phone: Bitget opens with the connection request to approve, and you stay in this browser.
  if (isMobile() && top?.name === "Bitget Wallet") { await chooseEvmUp(top); return; }
  // Bitget on a phone goes through WalletConnect like every other wallet (and like Bitget on Solana): its app opens
  // with the connection request and the member comes back here connected. It used to open this site inside
  // Bitget's own browser instead, which asked for a network again rather than showing the request to approve.
  // walletBase() picks bitkeep:// on phones, so Chrome never offers itself for the link.
  // Phone + a wallet with its own link + the link already made: open the wallet NOW, inside the tap (no waiting).
  if (isMobile() && top && (top.native || top.wc) && preReady()) {
    const base = walletBase(top)!, href = wcHref(base, pre!.uri, top.pkg);
    try { localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", JSON.stringify({ href: base, name: top.name })); } catch { /* private mode */ }
    flagWc(true);
    set({ open: true, busy: "", error: "", qr: { uri: pre!.uri, name: top.name, logo: top.logo, install: top.install, href } });
    openWalletApp(href);
    return; // prepareMobileWc's connect() finishes the connection when the wallet approves
  }
  // Tapped while the link is still being made: wait for it (a second or two), then show a big "Open" button
  // (a fresh tap always opens the wallet) and try opening it straight away too.
  if (isMobile() && top && (top.native || top.wc) && preparing) {
    set({ busy: top.name, error: "" });
    for (let i = 0; i < 40 && preparing; i++) await new Promise((r) => setTimeout(r, 150));
    if (preReady()) {
      const base = walletBase(top)!, href = wcHref(base, pre!.uri, top.pkg);
      try { localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", JSON.stringify({ href: base, name: top.name })); } catch { /* private mode */ }
      flagWc(true);
      set({ open: true, busy: "", qr: { uri: pre!.uri, name: top.name, logo: top.logo, install: top.install, href } });
      openWalletApp(href);
      return;
    }
  }
  // Any other way while a prepared link is waiting: drop it, so the two don't clash.
  if (pre && wc && !wc.session) { const old = wc; wc = null; pre = null; old.disconnect?.().catch(() => {}); }
  set({ busy: top?.name || "WalletConnect", error: "", qr: null });
  const mobile = isMobile();
  // On a phone: that wallet's own app opens with the request. On a computer: our window shows a code to scan
  // with that wallet's app. With no wallet named: WalletConnect's own list of 300+ wallets.
  const direct = mobile ? (top?.native || top?.wc ? top : undefined) : undefined;
  const ownQr = !mobile && !!top;
  try {
    await initWc();
    if (wc.session) {
      const id = netOf(state.network).chainId;
      if (id) await switchEvm(wc, id).catch(() => {});
      choose("WalletConnect", wc); return;
    }
    flagWc(true);
    if (direct || ownQr) {
      wc.rpc.showQrModal = false;
      wc.once("display_uri", (uri: string) => {
        if (direct) {
          const base = walletBase(direct)!, href = wcHref(base, uri, direct.pkg);
          try { localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", JSON.stringify({ href: base, name: direct.name })); } catch { /* private mode */ }
          // Also an "Open <wallet>" button, in case the phone blocks opening the app without a fresh tap.
          set({ open: true, qr: { uri, name: direct.name, logo: direct.logo, install: direct.install, href }, busy: "" });
          openWalletApp(href);
        } else set({ qr: { uri, name: top!.name, logo: top!.logo, install: top!.install }, busy: "" });
      });
    } else {
      // Hide our sheet while WalletConnect shows its own QR / wallet list.
      set({ open: false });
    }
    try { await wc.connect(); } finally { wc.rpc.showQrModal = true; }
    const id = netOf(state.network).chainId;
    if (id) await switchEvm(wc, id).catch(() => {});
    choose("WalletConnect", wc);
  } catch (e: any) {
    if (!wc?.session) flagWc(false);
    if (state.current) return; // picked up by the "connect" event meanwhile
    if (cancelled) { cancelled = false; return; }
    set({ open: true, busy: "", qr: null, error: /reset|reject|closed|cancel/i.test(String(e?.message)) ? "WalletConnect was closed. Try again, or pick another wallet." : String(e?.message || e).slice(0, 160) });
  }
}

let cancelled = false;
/** Back from the code to the wallet list: drop the half-made connection so the next try starts clean. */
export function cancelQr() {
  cancelled = true;
  set({ qr: null, busy: "" });
  const old = wc; wc = null; pre = null;
  old?.disconnect?.().catch(() => {});
  if (solWc && !solWc.session) { const o = solWc; solWc = null; o.disconnect?.().catch(() => {}); }
}

/** Forget the chosen wallet (and end a WalletConnect session). */
export async function disconnectWallet() {
  const p = state.current?.provider;
  set({ current: null });
  try { sessionStorage.removeItem("aw-wallet"); } catch { /* private mode */ }
  if (p && p === wc) { flagWc(false); await wc.disconnect().catch(() => {}); }
  if (p?.__up) { try { localStorage.removeItem(EVM_UP_KEY); } catch { /* private mode */ } await p.__up.disconnect?.().catch(() => {}); }
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: null })); } catch { /* old browsers */ }
}

/** Re-use the wallet picked earlier in this tab, without a pop-up, if it's still connected. */
export async function restoreWallet(): Promise<any | null> {
  startDiscovery();
  if (state.current) return state.current.provider;
  const up = await restoreEvmUp();
  if (up) return up;
  let name = "";
  try { name = sessionStorage.getItem("aw-wallet") || ""; } catch { /* private mode */ }
  // A WalletConnect session lives on after the page reloads or the wallet app opens a new tab.
  if ((name === "WalletConnect" || (!name && wcFlagAge() < Infinity)) && WALLETCONNECT_ID) {
    try {
      await initWc();
      if (wc.session) { if (!state.current) choose("WalletConnect", wc); return wc; }
    } catch { /* WalletConnect unreachable: carry on as not connected */ }
    if (wcFlagAge() > 15 * 60_000) flagWc(false);
    return null;
  }
  if (!name) return null;
  await new Promise((r) => setTimeout(r, 150)); // let wallets announce
  const d = state.detected.find((x) => x.info.name === name);
  const p = d?.provider ?? (name === "Browser wallet" ? legacyInjected() : null);
  if (!p) return null;
  const accts: string[] = await p.request({ method: "eth_accounts" }).catch(() => []);
  // Not connected any more (or the wallet has no EVM account): forget it, so the wallet isn't asked on every page.
  if (!accts?.length) { try { sessionStorage.removeItem("aw-wallet"); } catch { /* private mode */ } return null; }
  watchRequests(name, p);
  set({ current: { name, provider: p } });
  return p;
}

export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isIOS = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
/**
 * A browser built into another app (Telegram, Instagram, X, Facebook, TikTok…). These often refuse to open other
 * apps through their own link names (trust://, metamask://), but do pass on normal https wallet links.
 */
export const inAppBrowser = () => {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  return !!(window as any).TelegramWebviewProxy || !!(window as any).Telegram?.WebApp?.initData
    || /Telegram|FBAN|FBAV|Instagram|Twitter|TikTok|musical_ly|Line\/|MicroMessenger|Snapchat/i.test(ua);
};

/**
 * The best link to open a wallet app on this phone.
 * - iPhone and in-app browsers: the wallet's https link first (opens the app with no "Open in…?" question, and never
 *   shows "Safari can't open the page" when the app isn't installed).
 * - Android: the app's own link name first (opens only the wallet, never "Chrome or the wallet?").
 */
export function walletBase(t: { wc?: string; native?: string }): string | undefined {
  const https = t.wc && /^https:/.test(t.wc) ? t.wc : undefined;
  if (isIOS()) return https || t.native || t.wc;
  // Android: the app's own scheme first, so only the wallet opens (an https link offers Chrome too).
  if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) return t.native || https || t.wc;
  return t.native || t.wc;
}

/** Shows "Open <wallet>" and opens it. Inside that wallet's browser, connects the injected provider instead. */
export function showWalletOpen(name: string, logo: string, href: string, install?: string) {
  const id = TOP_WALLETS.find((w) => w.name === name)?.id || SOL_APPS.find((a) => a.name === name)?.id;
  if (id && insideWallet(id)) {
    const inj = injectedFor(id);
    if (inj) { choose(name, inj); return; }
    if (chooseSolInjected(id, name, logo)) return;
    set({ busy: "", error: `${name} isn't ready in this browser yet. Wait a second and tap it again.` });
    return;
  }
  set({ open: true, busy: "", error: "", qr: { uri: "", name, logo, install, href } });
  openWalletApp(href);
}

/** Opens the wallet app. Must run inside the tap. Telegram's mini apps need their own way to open links. */
export function openWalletApp(href: string) {
  try {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initData && typeof tg.openLink === "function" && /^https:/.test(href)) { tg.openLink(href); return; }
  } catch { /* not a Telegram mini app */ }
  // Custom scheme (bitkeep://, trust://, …): assign it on this tap. A hidden <a>.click() is not the
  // gesture Chrome counts, so it skips the app. An intent:// link then loads its https fallback, and
  // Android offers "Chrome or Bitget Wallet" because Bitget handles https too.
  if (!/^https?:/i.test(href)) {
    try { location.href = href; return; } catch { /* the Open button is there */ }
  }
  // iOS universal links: a real click keeps this page up so the signature can finish.
  try {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    try { location.href = href; } catch { /* the Open button is there */ }
  }
}

/** The wallet used last time on this device (for a "Last used" badge). */
export const lastWalletName = () => { try { return localStorage.getItem("aw-last-wallet") || ""; } catch { return ""; } };

// ---------------------------------------------------------------- Solana wallets

const isSolWallet = (w: Wallet) => "standard:connect" in w.features && "solana:signTransaction" in w.features && w.chains.some((c) => c.startsWith("solana:"));

/** Connects a Solana wallet (Phantom, Solflare, Backpack…). Remembered for this tab. */
export async function chooseSol(w: Wallet, silent = false): Promise<SolConn | null> {
  if (!silent) set({ busy: w.name, error: "" });
  try {
    const { accounts } = await (w.features["standard:connect"] as any).connect(silent ? { silent: true } : undefined);
    const account = (accounts as WalletAccount[]).find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts?.[0];
    if (!account) { if (!silent) set({ busy: "", error: "The wallet didn't share an account." }); return null; }
    const sol = { name: w.name, wallet: w, account };
    rememberNet("solana");
    set({ sol, open: false, busy: "", error: "" });
    try { sessionStorage.setItem("aw-sol", w.name); localStorage.setItem("aw-last-wallet", w.name); } catch { /* private mode */ }
    resolver?.(null); resolver = null;
    try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: w.name })); } catch { /* old browsers */ }
    return sol;
  } catch (e: any) {
    if (!silent) set({ busy: "", error: /reject|denied|cancel|declined/i.test(String(e?.message)) ? "You cancelled in the wallet." : String(e?.message || e).slice(0, 160) });
    return null;
  }
}

/** The Solana wallet connected earlier in this tab, without a pop-up, if it still allows it. */
export async function restoreSol(): Promise<SolConn | null> {
  startDiscovery();
  if (state.sol) return state.sol;
  let name = "";
  try { name = sessionStorage.getItem("aw-sol") || ""; } catch { /* private mode */ }
  if (!name || name.endsWith("(WalletConnect)")) return restoreSolWc();
  await new Promise((r) => setTimeout(r, 200));
  const w = state.solFound.find((x) => x.name === name);
  if (w) return chooseSol(w, true);
  const app = SOL_APPS.find((a) => a.name === name);
  const p = app ? injectedSolFor(app.id) : null;
  return p && app ? chooseSol(legacySolWallet(app.name, app.logo, p), true) : null;
}

export async function disconnectSol() {
  const w = state.sol?.wallet;
  set({ sol: null });
  try { sessionStorage.removeItem("aw-sol"); localStorage.removeItem("aw-sol-wc"); } catch { /* private mode */ }
  try { await (w?.features["standard:disconnect"] as any)?.disconnect(); } catch { /* fine */ }
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: null })); } catch { /* old browsers */ }
}

const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toB64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
/** Signs a base64 Solana transaction in the connected Solana wallet; returns it signed (base64). */
export async function signSol(txBase64: string): Promise<string> {
  const c = state.sol;
  if (!c) throw new Error("Connect a Solana wallet first.");
  const [out] = await (c.wallet.features["solana:signTransaction"] as any).signTransaction({ account: c.account, transaction: toBytes(txBase64), chain: "solana:mainnet" });
  return toB64(out.signedTransaction);
}

const wcLogo = (id: string) => `https://explorer-api.walletconnect.com/v3/logo/sm/${id}?projectId=${WALLETCONNECT_ID}`;
/**
 * Common wallets that work on Solana. Installed ones connect straight away (they show under "On this device");
 * the others open this page inside their app on a phone, or their download page on a computer.
 */
export const SOL_APPS: { id: string; name: string; logo: string; install: string; dapp: (url: string) => string; native?: string; wc?: string }[] = [
  { id: "bitget", native: "bitkeep://", wc: "https://bkcode.vip", name: "Bitget Wallet", logo: "/wallets/bitget.svg", install: "https://web3.bitget.com/en/wallet-download", dapp: (u) => bitgetOpenDapp(u) },
  { id: "trust", native: "trust://", wc: "https://link.trustwallet.com", name: "Trust Wallet", logo: "/wallets/trust.svg", install: "https://trustwallet.com/download", dapp: (u) => { const q = `open_url?coin_id=501&url=${encodeURIComponent(u)}`; return platformLink(`https://link.trustwallet.com/${q}`, { path: q, scheme: "trust", pkg: "com.wallet.crypto.trustapp" }); } },
  { id: "phantom", name: "Phantom", logo: "/wallets/phantom.svg", install: "https://phantom.com/download", dapp: (u) => browseLink("phantom.com/ul/browse", u, { scheme: "phantom", pkg: "app.phantom", path: "ul/browse" }) },
  { id: "solflare", name: "Solflare", logo: wcLogo("34c0e38d-66c4-470e-1aed-a6fabe2d1e00"), install: "https://solflare.com/download", dapp: (u) => browseLink("solflare.com/ul/v1/browse", u, { scheme: "solflare", pkg: "com.solflare.mobile", path: "ul/v1/browse" }) },
  { id: "okx", native: "okxwallet://main", name: "OKX Wallet", logo: "/wallets/okx.svg", install: "https://www.okx.com/web3", dapp: (u) => { const q = `wallet/dapp/url?dappUrl=${encodeURIComponent(u)}`; return platformLink(`okx://${q}`, { path: q, scheme: "okx", pkg: "com.okx.wallet" }); } },
  { id: "backpack", name: "Backpack", logo: wcLogo("71ca9daf-a31e-4d2a-fd01-f5dc2dc66900"), install: "https://backpack.app/downloads", dapp: (u) => browseLink("backpack.app/ul/v1/browse", u, { scheme: "https", pkg: "app.backpack.mobile", path: "backpack.app/ul/v1/browse" }) },
  { id: "coinbase", name: "Coinbase Wallet", logo: "/wallets/coinbase.svg", install: "https://www.coinbase.com/wallet/downloads", dapp: (u) => { const q = `dapp?url=${encodeURIComponent(u)}`; return platformLink(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}`, { path: q, scheme: "cbwallet", pkg: "org.toshi" }); } },
];

// ---------------------------------------------------------------- every WalletConnect wallet (600+)

export type ListedWallet = { id: string; name: string; logo: string; wc?: string; native?: string; install?: string; pkg?: string; rdns?: string; chains: string[] };
/** One page of WalletConnect's wallet list (searchable), with each wallet's logo and app link. */
export async function listWallets(page: number, search = ""): Promise<{ wallets: ListedWallet[]; total: number }> {
  if (!WALLETCONNECT_ID) return { wallets: [], total: 0 };
  const q = new URLSearchParams({ projectId: WALLETCONNECT_ID, entries: "40", page: String(page), ...(search ? { search } : {}) });
  const r = await fetch(`https://explorer-api.walletconnect.com/v3/wallets?${q}`).then((x) => x.json()).catch(() => null);
  const wallets = Object.values(r?.listings || {}).map((w: any): ListedWallet => {
    const uni = typeof w.mobile?.universal === "string" && w.mobile.universal && !w.mobile.universal.includes("?") ? w.mobile.universal : "";
    const nat = typeof w.mobile?.native === "string" ? w.mobile.native : "";
    const play = typeof w.app?.android === "string" ? w.app.android : "";
    const pkg = /[?&]id=([A-Za-z0-9._]+)/.exec(play)?.[1];
    return {
      id: String(w.id), name: String(w.name || "Wallet").slice(0, 40), logo: String(w.image_url?.sm || ""),
      wc: uni || undefined, native: nat || undefined, pkg, install: play || w.app?.ios || w.homepage || undefined,
      rdns: w.rdns || undefined, chains: Array.isArray(w.chains) ? w.chains : [],
    };
  });
  return { wallets, total: Number(r?.total || r?.count || wallets.length) };
}

// ---------------------------------------------------------------- Solana over WalletConnect (Bitget, Trust, OKX…)

const SOL_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
/**
 * Bitget: the same links the EVM WalletConnect route uses. The generic link on Android was bitkeep://wc?uri=…, which
 * opened Bitget with nothing to approve, so the picker used to send Bitget phones into Bitget's own browser, where
 * Bitget asks which Solana-type network the page needs (Solana, Eclipse, SOON…). bkcode.vip/wc shows the approval.
 */
const isBitget = (t: { name: string }) => t.name === "Bitget Wallet";
const solWcBase = (t: WcTarget) => (isBitget(t) ? BITGET_LINK : walletBase(t));
/** The Solana chain id the wallet approved (some wallets still answer on the older mainnet id). */
const SOL_MAINNET_OLD = "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ";
// The connect request, as Reown's own AppKit sends it for Solana: optional namespaces, every Solana method, and both
// mainnet ids (the older one is a workaround for wallets such as Bitget that only answer on it). Asking for the new id
// alone let Bitget connect on the old one and then quietly ignore every signing request sent on the new one.
const SOL_CONNECT = {
  optionalNamespaces: {
    solana: {
      methods: ["solana_signMessage", "solana_signTransaction", "solana_requestAccounts", "solana_getAccounts", "solana_signAllTransactions", "solana_signAndSendTransaction"],
      chains: [SOL_MAINNET, SOL_MAINNET_OLD],
      events: ["accountsChanged", "chainChanged"],
    },
  },
};
function solChainOf(up: any): string {
  const ns = up?.session?.namespaces?.solana;
  const ids: string[] = [...(ns?.chains || []), ...(ns?.accounts || []).map((a: string) => a.split(":").slice(0, 2).join(":"))];
  return ids.includes(SOL_MAINNET) ? SOL_MAINNET : ids.includes(SOL_MAINNET_OLD) ? SOL_MAINNET_OLD : SOL_MAINNET;
}
const solWcHref = (t: WcTarget, uri: string, base: string) => (isBitget(t) ? bitgetWcLink(uri) : wcHref(base, uri, t.pkg));
let solWc: any = null;
async function initSolWc() {
  if (solWc) return solWc;
  const { UniversalProvider } = await import("@walletconnect/universal-provider");
  solWc = await UniversalProvider.init({
    projectId: WALLETCONNECT_ID,
    customStoragePrefix: "autistik-sol2", // v2: sessions made with both Solana chain ids (older ones are dropped)
    metadata: {
      name: "AUTISTIK Hub", description: "Autism community, wallet and launch pad", url: location.origin, icons: [`${location.origin}/icons/icon-512.png`, `${location.origin}/icon.svg`],
      redirect: { native: location.origin + location.pathname, universal: location.origin + location.pathname },
    } as any,
  } as any);
  solWc.on("session_delete", () => { if (state.sol?.name.endsWith("(WalletConnect)")) set({ sol: null }); });
  return solWc;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of str) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("Bad signature from the wallet.");
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of str) { if (ch === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

/** A Solana WalletConnect session, shaped like a Wallet Standard wallet so the rest of the site can sign with it. */
function wcSolWallet(name: string, icon: string, up: any, address: string, base?: string): Wallet {
  return {
    version: "1.0.0", name: `${name} (WalletConnect)`, icon: icon as any, chains: ["solana:mainnet"], accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [{ address, publicKey: new Uint8Array(), chains: ["solana:mainnet"], features: ["solana:signTransaction"] }] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { await up.disconnect?.().catch(() => {}); } },
      "solana:signTransaction": {
        version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          let bin = ""; for (const b of transaction) bin += String.fromCharCode(b);
          // Bring the wallet app forward on phones, with an "Open <wallet>" bar until it's answered.
          const mobile = isMobile();
          const topic = up.session?.topic ? `?sessionTopic=${encodeURIComponent(up.session.topic)}` : "";
          const href = mobile && base ? pinAndroid(base.includes("://") && !/^https?:/.test(base) ? `${base.endsWith("/") || base.endsWith("://") ? base : base + "/"}wc${topic}` : `${base.replace(/\/$/, "")}/wc${topic}`) : undefined;
          const mine = { name, what: "the transaction", href, since: Date.now(), mobileWc: mobile };
          set({ pending: mine });
          if (href) setTimeout(() => openWalletApp(href), 300);
          let r: any;
          // Same request shape as Reown's own Solana connector: the transaction plus the account that signs it
          // (Bitget and others don't show the request without pubkey), on the Solana chain id this session uses.
          try { r = await up.request({ method: "solana_signTransaction", params: { transaction: btoa(bin), pubkey: address } }, solChainOf(up)); }
          finally { if (state.pending === mine) set({ pending: null }); }
          if (typeof r?.transaction === "string") return [{ signedTransaction: Uint8Array.from(atob(r.transaction), (c) => c.charCodeAt(0)) }];
          if (typeof r?.signature !== "string") throw new Error("The wallet didn't sign.");
          const { PublicKey, VersionedTransaction } = await import("@solana/web3.js");
          const tx = VersionedTransaction.deserialize(transaction);
          tx.addSignature(new PublicKey(address), b58decode(r.signature));
          return [{ signedTransaction: tx.serialize() }];
        },
      },
    } as any,
  } as Wallet;
}

// ---- Phones, Solana: the WalletConnect link is made BEFORE the tap (same reason as prepareMobileWc above).
// Before, the link was made after tapping Bitget, so the wallet app opened late or with no request in it.
let solPre: { uri: string; at: number; up: any; done: Promise<any> } | null = null;
let solPreparing = false;
const solPreReady = () => !!solPre && solPre.up === solWc && !!solWc && !solWc.session?.namespaces?.solana?.accounts?.[0] && Date.now() - solPre.at < PRE_FRESH;

export async function prepareSolWc() {
  if (!isMobile() || !WALLETCONNECT_ID || state.sol || solPreparing || solPreReady()) return;
  solPreparing = true;
  try {
    const up = await initSolWc();
    if (up.session?.namespaces?.solana?.accounts?.[0]) return;
    let done: Promise<any> = Promise.resolve();
    const uri = await new Promise<string>((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout")), 15_000);
      up.once?.("display_uri", (u: string) => { clearTimeout(t); res(u); });
      done = up.connect(SOL_CONNECT);
      done.catch(() => { if (solPre?.up === up) solPre = null; });
    });
    solPre = { uri, at: Date.now(), up, done };
  } catch { solPre = null; } finally { solPreparing = false; }
}

/**
 * Connect a wallet's Solana account through WalletConnect, like the other networks: on a phone the wallet app opens
 * to approve and you come back here connected; on a computer our window shows that wallet's code to scan.
 */
export async function chooseSolWalletConnect(t: WcTarget) {
  if (!WALLETCONNECT_ID) { set({ error: "WalletConnect isn't switched on yet." }); return; }
  const id = SOL_APPS.find((a) => a.name === t.name)?.id;
  if (id && insideWallet(id)) {
    if (chooseSolInjected(id, t.name, t.logo)) return;
    set({ busy: "", error: `${t.name} isn't ready in this browser yet. Wait a second and tap it again.` });
    return;
  }
  const mobile = isMobile();
  // Phone with the link already made: open the wallet inside this tap, then wait for the approval.
  const base = solWcBase(t);
  if (mobile && base && solPreReady()) {
    const p = solPre!;
    const href = solWcHref(t, p.uri, base);
    set({ open: true, busy: "", error: "", qr: { uri: p.uri, name: t.name, logo: t.logo, install: t.install, href } });
    openWalletApp(href);
    try { await p.done; solPre = null; await finishSolWc(t, p.up); }
    catch (e: any) {
      solPre = null;
      if (state.sol) return;
      if (cancelled) { cancelled = false; return; }
      set({ open: true, busy: "", qr: null, error: /reset|reject|closed|cancel/i.test(String(e?.message)) ? "Closed in the wallet. Try again, or pick another wallet." : String(e?.message || e).slice(0, 160) });
    }
    return;
  }
  set({ busy: t.name, error: "", qr: null });
  try {
    const up = await initSolWc();
    // A link made in the background but not used yet: use it instead of starting a second connection.
    if (solPreReady()) { const p = solPre!; const href = base && mobile ? solWcHref(t, p.uri, base) : undefined; set({ qr: { uri: p.uri, name: t.name, logo: t.logo, install: t.install, href }, busy: "" }); if (href) openWalletApp(href); await p.done; solPre = null; await finishSolWc(t, up); return; }
    if (up.session?.namespaces?.solana?.accounts?.[0]) { await finishSolWc(t, up); return; }
    up.once?.("display_uri", (uri: string) => {
      if (mobile && base) { const href = solWcHref(t, uri, base); set({ qr: { uri, name: t.name, logo: t.logo, install: t.install, href }, busy: "" }); openWalletApp(href); }
      else set({ qr: { uri, name: t.name, logo: t.logo, install: t.install }, busy: "" });
    });
    await up.connect(SOL_CONNECT);
    await finishSolWc(t, up);
  } catch (e: any) {
    if (state.sol) return;
    if (cancelled) { cancelled = false; return; }
    set({ open: true, busy: "", qr: null, error: /reset|reject|closed|cancel/i.test(String(e?.message)) ? "Closed in the wallet. Try again, or pick another wallet." : String(e?.message || e).slice(0, 160) });
  }
}
async function finishSolWc(t: WcTarget, up: any) {
  const acct = String(up.session?.namespaces?.solana?.accounts?.[0] || "");
  const address = acct.split(":")[2];
  if (!address) throw new Error("The wallet didn't share a Solana account.");
  await chooseSol(wcSolWallet(t.name, t.logo, up, address, solWcBase(t)));
  try { localStorage.setItem("aw-sol-wc", JSON.stringify(t)); } catch { /* private mode */ }
}
/** A Solana WalletConnect session from before a reload (or the trip to the wallet app). */
async function restoreSolWc(): Promise<SolConn | null> {
  let t: WcTarget | null = null;
  try { t = JSON.parse(localStorage.getItem("aw-sol-wc") || "null"); } catch { /* private mode */ }
  if (!t || !WALLETCONNECT_ID) return null;
  try {
    const up = await initSolWc();
    if (!up.session?.namespaces?.solana?.accounts?.[0]) return null;
    await finishSolWc(t, up);
    return state.sol;
  } catch { return null; }
}

/**
 * The signed copy of a Solana transaction that the wallet sent back over WalletConnect, if it arrived. Android often
 * reloads this tab while the member is in the wallet app, so the page that asked is gone; WalletConnect still keeps
 * the answer in its saved history, and this finds it by the transaction that was sent.
 */
export async function lostSolSign(txB64: string): Promise<Uint8Array | null> {
  try {
    if (!solWc) await restoreSolWc();
    const up: any = solWc;
    const recs: Map<number, any> | undefined = up?.client?.core?.history?.records;
    if (!recs) return null;
    for (const r of recs.values()) {
      const req = r?.request?.params?.request;
      if (req?.method !== "solana_signTransaction" || req?.params?.transaction !== txB64) continue;
      const res = r?.response?.result;
      if (typeof res?.transaction === "string") return Uint8Array.from(atob(res.transaction), (c) => c.charCodeAt(0));
      if (typeof res?.signature === "string") {
        const acct = String(up.session?.namespaces?.solana?.accounts?.[0] || "").split(":")[2];
        if (!acct) return null;
        const { PublicKey, VersionedTransaction } = await import("@solana/web3.js");
        const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0)));
        tx.addSignature(new PublicKey(acct), b58decode(res.signature));
        return tx.serialize();
      }
    }
  } catch { /* not there */ }
  return null;
}

/** Gets WalletConnect ready while the Connect window is open, so tapping a wallet opens it straight away. */
export function warmUp() {
  if (!WALLETCONNECT_ID || typeof window === "undefined") return;
  if (state.network === "solana") { if (isMobile()) prepareSolWc().catch(() => {}); else if (!solWc) initSolWc().catch(() => {}); }
  else if (!state.current) { if (isMobile()) prepareMobileWc().catch(() => {}); else initWc().catch(() => {}); }
}

