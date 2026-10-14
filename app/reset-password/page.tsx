import Link from "next/link";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password · AUTISTIK Hub" };

// Reached from the "reset your password" email, which signs the person in first.
export default async function ResetPasswordPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <div className="auth-card card stack">
        <h1>This link has expired</h1>
        <p className="muted">Password links work once and only for a short time. Ask for a new one.</p>
        <Link className="btn primary" href="/login?mode=forgot">Send me a new link</Link>
      </div>
    );
  }
  return <ResetPasswordForm email={user.email || ""} />;
}
