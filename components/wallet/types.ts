/** What the wallet screen needs from a wallet: its addresses and a way to approve transactions. */
export type EvmTxRequest = { to: `0x${string}`; data?: `0x${string}`; value: string };
export type Signer = {
  mode: "privy" | "browser";
  ready: boolean;
  /** Signed in (Privy) or connected (browser wallet). */
  active: boolean;
  label?: string | null;
  evm: {
    address: `0x${string}`;
    send: (chainId: number, tx: EvmTxRequest) => Promise<`0x${string}`>;
    /** Free signatures: an order (typed data) or a short message (cancelling). No transaction, no gas. */
    signTyped: (chainId: number, typed: { domain: any; types: any; primaryType: string; message: any }) => Promise<`0x${string}`>;
    signMessage: (message: string) => Promise<`0x${string}`>;
  } | null;
  /** Signs a base64 Solana transaction and returns it signed (base64). */
  sol: { address: string; sign: (txBase64: string) => Promise<string> } | null;
  login: () => void;
  /** Built-in wallet: sign in with email or a passkey. Connect: MetaMask, Trust, Phantom and others. */
  loginEmbedded?: () => void;
  loginExternal?: () => void;
  /** Which kind of wallet is in use right now. */
  using?: "embedded" | "external";
  /** When the member has both, switch between the built-in wallet and their own. */
  switchTo?: (kind: "embedded" | "external") => void;
  canSwitch?: boolean;
  logout: () => void;
  /** Opens the provider's secure screen to copy the private key (built-in wallet only). */
  exportKey?: (kind: "evm" | "solana") => void;
};

/** Where the page starts: wallet (?chain, ?buy, ?quick) or staking (?pool; admin tools for the admin). */
export type Start = { chain?: string; buy?: string; quick?: boolean; pool?: number; admin?: boolean };

/** The signed-in Hub member: their confirmed email, and the AUTISTIK wallet made for it when they joined (if known). */
export type Member = { email: string; evm: string | null; sol: string | null };
