import Link from "next/link";

export const metadata = { title: "Not in the app · AUTISTIK Hub" };

// Where the Google Play app (Community version) lands when a link points at a money feature (wallet, swap, launch…).
export default function InAppPage() {
  return (
    <div className="stack" style={{ maxWidth: 560, margin: "40px auto", textAlign: "center" }}>
      <h1>Not part of the app</h1>
      <p className="muted">The AUTISTIK app is the community edition: groups, chats, live rooms, Believer and coin checks. Wallet, trading and launching aren&apos;t included in it.</p>
      <div className="row" style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <Link className="btn primary" href="/app">Back to the app</Link>
        <Link className="btn" href="/analytics">Check a coin</Link>
      </div>
    </div>
  );
}
