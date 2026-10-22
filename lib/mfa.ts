import type { User } from "@supabase/supabase-js";

/**
 * Every account needs a 6-digit code from an authenticator app (2-step verification) as well as its password or
 * email link. Where this visitor stands:
 * - "ok": not signed in, or signed in AND entered their code this session
 * - "setup": signed in, but hasn't added an authenticator app yet
 * - "code": has an authenticator app, but hasn't entered a code this session
 * The database enforces the same rule (supabase/user-2fa.sql), so skipping the page doesn't get around it.
 */
export type MfaStep = "ok" | "setup" | "code";

export function mfaStep(user: User | null | undefined, aal: string | null | undefined): MfaStep {
  if (!user || aal === "aal2") return "ok";
  return user.factors?.some((f) => f.status === "verified") ? "code" : "setup";
}

/** Pages a signed-in member can still open before finishing 2-step verification. */
export const MFA_FREE = /^\/(security|auth|login|safety|api|\.well-known)(\/|$)|\.[a-z0-9]+$/i;
