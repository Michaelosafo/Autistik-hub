/** AI Pass: a few free tries per account, then pay in BNB to keep using Believer and Purity. */
export const AI_PASS_USD = Number(process.env.NEXT_PUBLIC_AI_PASS_USD || 5);
export const AI_PASS_DAYS = Number(process.env.NEXT_PUBLIC_AI_PASS_DAYS || 30);
export const AI_FREE_TRIES = Number(process.env.NEXT_PUBLIC_AI_FREE_TRIES ?? 2);

/**
 * The account's id, sent as the payment's data. It ties a BNB payment to one Hub account, so nobody can
 * copy someone else's transaction from BscScan and claim it.
 */
export function passTag(userId: string): `0x${string}` {
  return ("0x" + userId.replace(/-/g, "").toLowerCase()) as `0x${string}`;
}
