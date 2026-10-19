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
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
type Detected = { info: WalletInfo; provider: any };

/** Top wallets, in the order shown. `rdns` matches what the wallet announces when installed. */
export const TOP_WALLETS: { id: string; name: string; rdns: string[]; color: string; install: string; dapp?: (url: string) => string }[] = [
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.mobile"], color: "#F6851B", install: "https://metamask.io/download/", dapp: (u) => `https://metamask.app.link/dapp/${u.replace(/^https?:\/\//, "")}` },
  { id: "trust", name: "Trust Wallet", rdns: ["com.trustwallet.app"], color: "#0500FF", install: "https://trustwallet.com/download", dapp: (u) => `https://link.trustwallet.com/open_url?coin_id=20000714&url=${encodeURIComponent(u)}` },
  { id: "binance", name: "Binance Wallet", rdns: ["com.binance.wallet", "com.binance"], color: "#F0B90B", install: "https://www.binance.com/en/web3wallet" },
  { id: "okx", name: "OKX Wallet", rdns: ["com.okex.wallet"], color: "#111111", install: "https://www.okx.com/web3", dapp: (u) => `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(u)}` },
  { id: "coinbase", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], color: "#0052FF", install: "https://www.coinbase.com/wallet/downloads", dapp: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { id: "bitget", name: "Bitget Wallet", rdns: ["com.bitget.web3"], color: "#00F0FF", install: "https://web3.bitget.com/en/wallet-download", dapp: (u) => `https://bkcode.vip?action=dapp&url=${encodeURIComponent(u)}` },
  { id: "safepal", name: "SafePal", rdns: ["com.safepal"], color: "#4A21EF", install: "https://www.safepal.com/download" },
  { id: "tokenpocket", name: "TokenPocket", rdns: ["pro.tokenpocket"], color: "#2980FE", install: "https://www.tokenpocket.pro/en/download/app" },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], color: "#7084FF", install: "https://rabby.io/" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], color: "#AB9FF2", install: "https://phantom.com/download" },
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

// ---------------------------------------------------------------- state shared with the sheet

type State = { open: boolean; detected: Detected[]; current: { name: string; provider: any } | null; error: string; busy: string };
let state: State = { open: false, detected: [], current: null, error: "", busy: "" };
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
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const d = e?.detail as Detected | undefined;
    if (!d?.info?.uuid || !d.provider) return;
    if (state.detected.some((x) => x.info.uuid === d.info.uuid)) return;
    set({ detected: [...state.detected, { info: { uuid: String(d.info.uuid), name: String(d.info.name).slice(0, 40), icon: String(d.info.icon || ""), rdns: String(d.info.rdns || "") }, provider: d.provider }] });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** The plain injected wallet, for wallet apps' own browsers that don't announce themselves. */
export function legacyInjected(): any | null {
  if (typeof window === "undefined") return null;
  const eth = (window as any).ethereum;
  return eth && typeof eth.request === "function" ? eth : null;
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
  set({ open: false, busy: "" });
  resolver?.(null); resolver = null;
}

function choose(name: string, provider: any) {
  set({ current: { name, provider }, open: false, busy: "", error: "" });
  try { sessionStorage.setItem("aw-wallet", name); } catch { /* private mode */ }
  resolver?.(provider); resolver = null;
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: name })); } catch { /* old browsers */ }
}

/** Use a wallet that's installed in this browser. */
export async function chooseInjected(name: string, provider: any) {
  set({ busy: name, error: "" });
  try {
    await provider.request({ method: "eth_requestAccounts" });
    choose(name, provider);
  } catch (e: any) {
    set({ busy: "", error: /reject|denied|cancel/i.test(String(e?.message)) ? "You cancelled in the wallet." : String(e?.message || e).slice(0, 160) });
  }
}

let wc: any = null;
/** WalletConnect: a QR code on a computer; on a phone, a list of wallet apps that opens the one picked. */
export async function chooseWalletConnect() {
  if (!WALLETCONNECT_ID) { set({ error: "WalletConnect isn't switched on yet. Open this site inside your wallet app's browser instead." }); return; }
  set({ busy: "WalletConnect", error: "" });
  try {
    if (!wc) {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      wc = await EthereumProvider.init({
        projectId: WALLETCONNECT_ID,
        chains: [56],
        optionalChains: [1, 8453, 42161, 10, 137, 43114, 59144, 130],
        showQrModal: true,
        qrModalOptions: { themeMode: "dark", explorerRecommendedWalletIds: WC_FEATURED } as any,
        metadata: { name: "AUTISTIK Hub", description: "Autism community, wallet and launch pad", url: location.origin, icons: [`${location.origin}/icon.svg`] },
      });
      wc.on("disconnect", () => { if (state.current?.provider === wc) set({ current: null }); });
    }
    // Hide our sheet while WalletConnect shows its own QR / wallet list.
    set({ open: false });
    if (!wc.session) await wc.connect();
    choose("WalletConnect", wc);
  } catch (e: any) {
    set({ open: true, busy: "", error: /reset|reject|closed|cancel/i.test(String(e?.message)) ? "WalletConnect was closed. Try again, or pick another wallet." : String(e?.message || e).slice(0, 160) });
  }
}

/** Forget the chosen wallet (and end a WalletConnect session). */
export async function disconnectWallet() {
  const p = state.current?.provider;
  set({ current: null });
  try { sessionStorage.removeItem("aw-wallet"); } catch { /* private mode */ }
  if (p && p === wc) await wc.disconnect().catch(() => {});
  try { window.dispatchEvent(new CustomEvent("aw-wallet-changed", { detail: null })); } catch { /* old browsers */ }
}

/** Re-use the wallet picked earlier in this tab, without a pop-up, if it's still connected. */
export async function restoreWallet(): Promise<any | null> {
  startDiscovery();
  if (state.current) return state.current.provider;
  let name = "";
  try { name = sessionStorage.getItem("aw-wallet") || ""; } catch { /* private mode */ }
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
