/** What the wallet screen needs from a wallet: its addresses and a way to approve transactions. */
export type EvmTxRequest = { to: `0x${string}`; data?: `0x${string}`; value: string };
export type Signer = {
  mode: "privy" | "browser";
  ready: boolean;
  /** Signed in (Privy) or connected (browser wallet). */
  active: boolean;
  label?: string | null;
  evm: { address: `0x${string}`; send: (chainId: number, tx: EvmTxRequest) => Promise<`0x${string}`> } | null;
  /** Signs a base64 Solana transaction and returns it signed (base64). */
  sol: { address: string; sign: (txBase64: string) => Promise<string> } | null;
  login: () => void;
  logout: () => void;
  /** Opens the provider's secure screen to copy the private key (built-in wallet only). */
  exportKey?: (kind: "evm" | "solana") => void;
};
