/** Only allow redirects to pages on this site, never to another website. */
export function safeNext(v: string | null | undefined, fallback = "/companions") {
  const s = String(v || "");
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return fallback;
  // Never send people back to the sign-in pages themselves (that would loop).
  if (/^\/(login|auth|reset-password)(\/|\?|$)/.test(s)) return fallback;
  return s;
}

export const MIN_PASSWORD = 8;

/** Plain-language versions of Supabase's sign-in errors. */
export function authMessage(raw: string | undefined | null): string {
  const m = String(raw || "").toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("network request failed"))
    return "We couldn't reach the sign-in service. Check your internet, turn off any ad blocker or VPN for this site, and try again. If it keeps happening, the site's sign-in settings need fixing (see /api/health).";
  if (m.includes("captcha")) return "The \"are you human\" check didn't pass. Refresh the page and try again.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many tries. Please wait a few minutes and try again.";
  if (m.includes("invalid login credentials")) return "That email and password don't match. Check them, or reset your password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. Open the email from AUTISTIK Hub and press the button. You can send it again below.";
  if (m.includes("already registered") || m.includes("already been registered")) return "There's already an account with this email. Sign in instead, or reset your password.";
  if (m.includes("password should be") || m.includes("weak password")) return `Choose a stronger password: at least ${MIN_PASSWORD} characters, with letters and numbers.`;
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) return "Too many tries. Please wait a minute and try again.";
  if (m.includes("expired") || m.includes("invalid") && m.includes("token")) return "That link has expired or was already used. Ask for a new one below.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "New accounts are switched off right now. Please try again later.";
  return raw ? String(raw) : "Something went wrong. Please try again.";
}
