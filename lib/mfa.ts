import type { User } from "@supabase/supabase-js";

/**
 * 2-step verification (a 6-digit code from an authenticator app) is optional. Members who turn it on must type the
 * code at every sign-in. Where this visitor stands:
 * - "ok": not signed in, signed in without 2-step verification, or signed in AND entered their code this session
 * - "code": has turned 2-step verification on, but hasn't entered a code this session
 * The database enforces the same rule (supabase/user-2fa.sql), so skipping the page doesn't get around it.
 */
export type MfaStep = "ok" | "code";

export function mfaStep(user: User | null | undefined, aal: string | null | undefined): MfaStep {
  if (!user || aal === "aal2") return "ok";
  return user.factors?.some((f) => f.status === "verified") ? "code" : "ok";
}

/** Pages a signed-in member can still open before typing their 2-step code. */
export const MFA_FREE = /^\/(security|auth|login|safety|privacy|api|\.well-known)(\/|$)|\.[a-z0-9]+$/i;
