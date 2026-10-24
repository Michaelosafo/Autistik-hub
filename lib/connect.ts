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

/** Top wallets, in the order shown. `rdns` matches what the wallet announces when installed. */
export const TOP_WALLETS: { id: string; name: string; rdns: string[]; color: string; install: string; dapp?: (url: string) => string; wc?: string }[] = [
  // `wc`: the wallet's own WalletConnect link on phones, so it opens straight away and comes back to this browser.
  // Logos live in /public/wallets/<id>.svg.
  // Bitget and Trust first: both handle every network and switch between them easily.
  { id: "bitget", name: "Bitget Wallet", rdns: ["com.bitget.web3"], color: "#00F0FF", install: "https://web3.bitget.com/en/wallet-download", wc: "https://bkapp.vip", dapp: (u) => `https://bkcode.vip?action=dapp&url=${encodeURIComponent(u)}` },
  { id: "trust", name: "Trust Wallet", rdns: ["com.trustwallet.app"], color: "#0500FF", install: "https://trustwallet.com/download", wc: "https://link.trustwallet.com", dapp: (u) => `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(u)}` },
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.mobile"], color: "#F6851B", install: "https://metamask.io/download/", wc: "https://metamask.app.link", dapp: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { id: "binance", name: "Binance Wallet", rdns: ["com.binance.wallet", "com.binance"], color: "#F0B90B", install: "https://www.binance.com/en/web3wallet", wc: "https://app.binance.com/cedefi" },
  { id: "okx", name: "OKX Wallet", rdns: ["com.okex.wallet"], color: "#111111", install: "https://www.okx.com/web3", wc: "okex://main", dapp: (u) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { id: "coinbase", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], color: "#0052FF", install: "https://www.coinbase.com/wallet/downloads", dapp: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { id: "safepal", name: "SafePal", rdns: ["com.safepal"], color: "#4A21EF", install: "https://www.safepal.com/download", wc: "https://link.safepal.io" },
  { id: "tokenpocket", name: "TokenPocket", rdns: ["pro.tokenpocket"], color: "#2980FE", install: "https://www.tokenpocket.pro/en/download/app", wc: "tpoutside://", dapp: (u) => `tpdapp://open?params=${encodeURIComponent(JSON.stringify({ url: u }))}` },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], color: "#7084FF", install: "https://rabby.io/", wc: "rabby://" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#AB9FF2", install: "https://phantom.com/download", dapp: (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(new URL(u).origin)}` },
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
/** Network logos (from LI.FI, through the Hub), loaded once per visit. Missing ones show a coloured dot. */
let logoReq: Promise<Record<number, string>> | null = null;
export const netLogos = () => (logoReq ??= fetch("/api/wallet/x-chains", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
  .then((r) => r.json()).then((d) => (d?.logos && typeof d.logos === "object" ? d.logos : {})).catch(() => ({})));
/** The ones shown first. */
export const TOP_NETWORKS = ["bsc", "ethereum", "solana", "base", "arbitrum"];
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
  qr: { uri: string; name: string; logo: string; install?: string } | null;
};
let state: State = { open: false, detected: [], current: null, error: "", busy: "", network: "bsc", solFound: [], sol: null, qr: null };
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
    if (document.visibilityState === "visible" && !state.current && wc?.session) choose("WalletConnect", wc);
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
    case "bitget": return [w.bitkeep?.ethereum, w.bitget?.ethereum].find(isEip1193) ?? flag((p) => p.isBitKeep || p.isBitgetWallet);
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

function choose(name: string, provider: any) {
  if (name === "WalletConnect") flagWc(true);
  watchChain(provider);
  set({ current: { name, provider }, open: false, busy: "", error: "", qr: null });
  try { sessionStorage.setItem("aw-wallet", name); localStorage.setItem("aw-last-wallet", name); } catch { /* private mode */ }
  resolver?.(provider); resolver = null;
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: name })); } catch { /* old browsers */ }
}

/** Use a wallet that's installed in this browser. */
export async function chooseInjected(name: string, provider: any) {
  set({ busy: name, error: "" });
  try {
    await provider.request({ method: "eth_requestAccounts" });
    const id = netOf(state.network).chainId;
    if (id) await switchEvm(provider, id).catch(() => { /* they can switch later from the network button */ });
    choose(name, provider);
  } catch (e: any) {
    set({ busy: "", error: /reject|denied|cancel/i.test(String(e?.message)) ? "You cancelled in the wallet." : String(e?.message || e).slice(0, 160) });
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
async function initWc(chainId = netOf(state.network).chainId || 56) {
  // A new network before connecting: start a fresh WalletConnect with that network required.
  if (wc && !wc.session && wcChain !== chainId) { try { await wc.disconnect(); } catch { /* not connected */ } wc = null; }
  if (wc) return wc;
  wcChain = chainId;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wc = await EthereumProvider.init({
    projectId: WALLETCONNECT_ID,
    // The network picked is the one required network: Trust Wallet and several others refuse a connection that
    // names no required network at all. Every other network stays optional, so nothing else needs approving up front.
    chains: [chainId],
    rpcMap: Object.fromEntries(NETWORKS.filter((n) => n.chainId).map((n) => [n.chainId!, (n.add as any).rpcUrls[0]])),
    optionalChains: NETWORKS.filter((n) => n.chainId).map((n) => n.chainId!) as [number, ...number[]],
    showQrModal: true,
    qrModalOptions: { themeMode: "dark", explorerRecommendedWalletIds: WC_FEATURED } as any,
    metadata: {
      name: "AUTISTIK Hub", description: "Autism community, wallet and launch pad", url: location.origin, icons: [`${location.origin}/icon.svg`],
      // Where the wallet app sends the member back after they approve: this page, in their browser.
      redirect: { universal: location.origin + location.pathname },
    } as any,
  });
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
export type WcTarget = { name: string; logo: string; wc?: string; install?: string };

/** The wallet app's WalletConnect link (same rules as WalletConnect's own list). */
export function wcHref(base: string, uri: string) {
  const u = encodeURIComponent(uri);
  if (base.includes("://") && !/^https?:/.test(base)) {
    const b = base.endsWith("://") ? base : base.endsWith("/") ? base : base + "/";
    return `${b}wc?uri=${u}`;
  }
  return `${base.replace(/\/$/, "")}/wc?uri=${u}`;
}

export async function chooseWalletConnect(walletId?: string | WcTarget) {
  if (!WALLETCONNECT_ID) { set({ error: "WalletConnect isn't switched on yet. Open this site inside your wallet app's browser instead." }); return; }
  const t = typeof walletId === "object" ? walletId : TOP_WALLETS.find((w) => w.id === walletId);
  const top: WcTarget | undefined = !t ? undefined : "id" in t ? { name: t.name, logo: `/wallets/${(t as any).id}.svg`, wc: (t as any).wc, install: (t as any).install } : t;
  set({ busy: top?.name || "WalletConnect", error: "", qr: null });
  const mobile = isMobile();
  // On a phone: that wallet's own app opens with the request. On a computer: our window shows a code to scan
  // with that wallet's app. With no wallet named: WalletConnect's own list of 300+ wallets.
  const direct = mobile ? (top?.wc ? top : undefined) : undefined;
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
          try { localStorage.setItem("WALLETCONNECT_DEEPLINK_CHOICE", JSON.stringify({ href: direct.wc, name: direct.name })); } catch { /* private mode */ }
          location.href = wcHref(direct.wc!, uri);
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
  const old = wc; wc = null;
  old?.disconnect?.().catch(() => {});
}

/** Forget the chosen wallet (and end a WalletConnect session). */
export async function disconnectWallet() {
  const p = state.current?.provider;
  set({ current: null });
  try { sessionStorage.removeItem("aw-wallet"); } catch { /* private mode */ }
  if (p && p === wc) { flagWc(false); await wc.disconnect().catch(() => {}); }
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: null })); } catch { /* old browsers */ }
}

/** Re-use the wallet picked earlier in this tab, without a pop-up, if it's still connected. */
export async function restoreWallet(): Promise<any | null> {
  startDiscovery();
  if (state.current) return state.current.provider;
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
  if (!accts?.length) return null;
  set({ current: { name, provider: p } });
  return p;
}

export const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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
  if (!name) return null;
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
  try { sessionStorage.removeItem("aw-sol"); } catch { /* private mode */ }
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
const browse = (base: string) => (u: string) => `${base}/${encodeURIComponent(u)}?ref=${encodeURIComponent(new URL(u).origin)}`;
/**
 * Common wallets that work on Solana. Installed ones connect straight away (they show under "On this device");
 * the others open this page inside their app on a phone, or their download page on a computer.
 */
export const SOL_APPS: { id: string; name: string; logo: string; install: string; dapp: (url: string) => string }[] = [
  { id: "bitget", name: "Bitget Wallet", logo: "/wallets/bitget.svg", install: "https://web3.bitget.com/en/wallet-download", dapp: (u) => `https://bkcode.vip?action=dapp&url=${encodeURIComponent(u)}` },
  { id: "trust", name: "Trust Wallet", logo: "/wallets/trust.svg", install: "https://trustwallet.com/download", dapp: (u) => `https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(u)}` },
  { id: "phantom", name: "Phantom", logo: "/wallets/phantom.svg", install: "https://phantom.com/download", dapp: browse("https://phantom.app/ul/browse") },
  { id: "solflare", name: "Solflare", logo: wcLogo("34c0e38d-66c4-470e-1aed-a6fabe2d1e00"), install: "https://solflare.com/download", dapp: browse("https://solflare.com/ul/v1/browse") },
  { id: "okx", name: "OKX Wallet", logo: "/wallets/okx.svg", install: "https://www.okx.com/web3", dapp: (u) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { id: "backpack", name: "Backpack", logo: wcLogo("71ca9daf-a31e-4d2a-fd01-f5dc2dc66900"), install: "https://backpack.app/downloads", dapp: browse("https://backpack.app/ul/v1/browse") },
  { id: "coinbase", name: "Coinbase Wallet", logo: "/wallets/coinbase.svg", install: "https://www.coinbase.com/wallet/downloads", dapp: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
];

// ---------------------------------------------------------------- every WalletConnect wallet (600+)

export type ListedWallet = { id: string; name: string; logo: string; wc?: string; install?: string; rdns?: string; chains: string[] };
/** One page of WalletConnect's wallet list (searchable), with each wallet's logo and app link. */
export async function listWallets(page: number, search = ""): Promise<{ wallets: ListedWallet[]; total: number }> {
  if (!WALLETCONNECT_ID) return { wallets: [], total: 0 };
  const q = new URLSearchParams({ projectId: WALLETCONNECT_ID, entries: "40", page: String(page), ...(search ? { search } : {}) });
  const r = await fetch(`https://explorer-api.walletconnect.com/v3/wallets?${q}`).then((x) => x.json()).catch(() => null);
  const wallets = Object.values(r?.listings || {}).map((w: any): ListedWallet => {
    const uni = typeof w.mobile?.universal === "string" && w.mobile.universal && !w.mobile.universal.includes("?") ? w.mobile.universal : "";
    const nat = typeof w.mobile?.native === "string" ? w.mobile.native : "";
    return {
      id: String(w.id), name: String(w.name || "Wallet").slice(0, 40), logo: String(w.image_url?.sm || ""),
      wc: uni || nat || undefined, install: w.app?.ios || w.app?.android || w.homepage || undefined,
      rdns: w.rdns || undefined, chains: Array.isArray(w.chains) ? w.chains : [],
    };
  });
  return { wallets, total: Number(r?.total || r?.count || wallets.length) };
}
