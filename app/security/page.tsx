import Link from "next/link";
import { redirect } from "next/navigation";
import AccountSecurity from "@/components/AccountSecurity";
import AuthenticatorGuide from "@/components/AuthenticatorGuide";
import { safeNext } from "@/lib/auth";
import { accountState } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security · AUTISTIK Hub" };

// Members can turn on 2-step verification here (optional). Those who have it type its code here at each sign-in.
// Signed out, it's the step-by-step guide.
export default async function SecurityPage({ searchParams }: { searchParams: { next?: string; welcome?: string } }) {
  const { user, mfa } = await accountState();
  // A password-reset email signs you in; the new password is chosen after the 2-step code.
  const next = searchParams.next === "/reset-password" ? "/reset-password" : safeNext(searchParams.next, "/companions");
  const welcome = searchParams.welcome === "1";
  if (user && mfa === "ok" && searchParams.next && !welcome) redirect(next);
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div className="label">Account security</div>
        <h1>{mfa === "code" ? "Confirm it's you" : "2-step verification"}</h1>
        <p className="muted">Optional extra protection: your password plus a code from your phone. Even if someone learns your password, they can&apos;t get into your account.</p>
      </div>
      {user
        ? <AccountSecurity step={mfa} next={next} email={user.email || "your account"} welcome={welcome} />
        : <div className="row"><Link className="btn primary" href="/login?next=/security">Sign in to set it up</Link></div>}
      <AuthenticatorGuide />
    </div>
  );
}
