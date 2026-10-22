/**
 * Server side of the built-in AUTISTIK wallet (Privy). SERVER ONLY: uses PRIVY_APP_SECRET.
 *
 * Every member with a confirmed email gets a wallet made for that email as soon as they join. Privy splits the key
 * and keeps it in secure hardware: this server can create the wallet and read its address, but never sees the key
 * and can't move funds. Only the member can, after signing in to the wallet with a code sent to that same email.
 */
const clean = (v: string | undefined) => (v && /^[a-z0-9]{10,40}$/i.test(v.trim()) ? v.trim() : null);
export const PRIVY_APP_ID = clean(process.env.PRIVY_APP_ID) || clean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
const SECRET = (process.env.PRIVY_APP_SECRET || "").trim();

export const privyServerReady = () => !!(PRIVY_APP_ID && SECRET);

export type MemberWallet = { evm: string | null; sol: string | null };

async function privy(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(`https://api.privy.io/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "privy-app-id": PRIVY_APP_ID!,
      authorization: "Basic " + Buffer.from(`${PRIVY_APP_ID}:${SECRET}`).toString("base64"),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

/** The built-in (Privy-made) wallets on a Privy user, never wallets they connected themselves. */
function walletsOf(user: any): MemberWallet {
  const own = (user?.linked_accounts || []).filter((a: any) => a?.type === "wallet" && a?.wallet_client_type === "privy");
  return {
    evm: own.find((a: any) => a.chain_type === "ethereum")?.address ?? null,
    sol: own.find((a: any) => a.chain_type === "solana")?.address ?? null,
  };
}

/**
 * Finds the member's wallet, or makes one (EVM + Solana) the first time. Only call it with an email the member has
 * confirmed, because whoever controls that inbox controls the wallet. Never throws: on any problem it returns null and
 * the wallet is made instead the first time they open it.
 */
export async function ensureMemberWallet(email: string | null | undefined): Promise<MemberWallet | null> {
  const address = String(email || "").trim().toLowerCase();
  if (!privyServerReady() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return null;
  try {
    const found = await privy("/users/email/address", { address });
    if (found.status === 200 && found.data) return walletsOf(found.data);
    if (found.status !== 404) return null;
    const made = await privy("/users", {
      linked_accounts: [{ type: "email", address }],
      wallets: [{ chain_type: "ethereum" }, { chain_type: "solana" }],
    });
    return made.status < 300 && made.data ? walletsOf(made.data) : null;
  } catch {
    return null;
  }
}

/** The signed-in member as the wallet screens need them: their confirmed email and their AUTISTIK wallet's addresses. */
export type WalletMember = { email: string; evm: string | null; sol: string | null };

export async function walletMember(): Promise<WalletMember | null> {
  const { currentUser } = await import("@/lib/supabase/server");
  const user = await currentUser().catch(() => null);
  if (!user?.email || !user.email_confirmed_at) return null;
  const w = await ensureMemberWallet(user.email);
  return { email: user.email.toLowerCase(), evm: w?.evm ?? null, sol: w?.sol ?? null };
}
