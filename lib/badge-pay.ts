/** The AUTISTIK sticker badge: pay this many US dollars in BNB (BNB Chain) to the treasury for this many days. */
export const BADGE_USD = Number(process.env.NEXT_PUBLIC_BADGE_USD || 1);
export const BADGE_DAYS = Number(process.env.NEXT_PUBLIC_BADGE_DAYS || 365);
/** The data a badge payment carries: the member's id (hex, no dashes), so only they can claim it. */
export const badgeMemo = (userId: string) => `0x${userId.replace(/-/g, "").toLowerCase()}` as `0x${string}`;
