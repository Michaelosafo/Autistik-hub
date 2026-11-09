import Link from "next/link";
import DeleteAccount from "@/components/DeleteAccount";
import { LINKS } from "@/lib/site";
import { accountState } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delete your account · AUTISTIK Hub", description: "How to delete your AUTISTIK Hub account and the data linked to it." };

// The account deletion page (also the link given to Google Play): delete it here, or ask by email.
export default async function DeleteAccountPage() {
  const { user, mfa } = await accountState();
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div className="label">Account</div>
        <h1>Delete your account</h1>
        <p className="muted">You can delete your AUTISTIK Hub account at any time, in the app or on the website.</p>
      </div>
      <div className="card stack">
        <b>What gets deleted</b>
        <ul className="muted">
          <li>Your account, profile, meme name and picture</li>
          <li>Your posts, Tik posts, likes, follows, chats and messages</li>
          <li>Your live rooms and recordings, alerts, saved coins and settings</li>
          <li>Your 2-step verification apps and push notifications</li>
          <li>Your AI chats and passes (unused time on a pass is not refunded)</li>
        </ul>
        <b>What stays</b>
        <ul className="muted">
          <li>Anything on a blockchain (wallet addresses, transactions, coins you launched) is public and can&apos;t be deleted by anyone. Coins you launched stay listed without your name.</li>
          <li>Records we must keep by law (for example payment records) for as long as the law requires.</li>
          <li>Security logs are deleted automatically within 180 days.</li>
        </ul>
        <b>Your wallet</b>
        <p className="muted">Your coins are in your own wallet, not in your Hub account. Before deleting, move your coins out of the built-in AUTISTIK wallet, or save its private key (Wallet → Security → Export key). After the account is gone, the built-in wallet can&apos;t be opened from the Hub any more.</p>
      </div>
      {user
        ? mfa === "ok" ? <DeleteAccount email={user.email || "your account"} />
          : <div className="row"><Link className="btn primary" href="/security?next=/account/delete">Enter your 2-step code first</Link></div>
        : (
          <div className="card stack">
            <b>Not signed in?</b>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}><Link className="btn primary" href="/login?next=/account/delete">Sign in to delete your account</Link></div>
            <p className="muted">Can&apos;t sign in? Email <a href={`mailto:${LINKS.email}?subject=Delete%20my%20AUTISTIK%20Hub%20account`}>{LINKS.email}</a> from the email address on the account and we&apos;ll delete it within 30 days.</p>
          </div>
        )}
      <p className="muted">More about your data: <Link href="/privacy">Privacy policy</Link></p>
    </div>
  );
}
