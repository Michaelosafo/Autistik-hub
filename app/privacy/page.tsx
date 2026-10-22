import Link from "next/link";
import { LINKS } from "@/lib/site";

export const metadata = {
  title: "Privacy policy · AUTISTIK Hub",
  description: "What AUTISTIK Hub collects, why, who it's shared with, how long it's kept, and how to see or delete it.",
};

const UPDATED = "22 October 2026";

/** The full privacy policy. Plain words, but complete: Google's sign-in review and app stores read this page. */
export default function Privacy() {
  const mail = <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a>;
  return (
    <div className="stack" style={{ maxWidth: 740 }}>
      <div className="card stack">
        <div className="label">Privacy policy</div>
        <h1 style={{ margin: 0 }}>How AUTISTIK Hub handles your data</h1>
        <p className="muted" style={{ margin: 0 }}>Last updated {UPDATED}</p>
        <p style={{ margin: 0 }}>
          AUTISTIK Hub (<a href="https://autistik.io">autistik.io</a>) is a community site for autistic adults and holders of the $AUTISTIK
          token. It is run by the AUTISTIK team (&quot;we&quot;, &quot;us&quot;). This page explains what information we collect, why, who it is
          shared with, how long we keep it, and how you can see or delete it. Questions: email {mail}.
        </p>
      </div>

      <div className="card stack">
        <h2>1. What we collect</h2>
        <h3 style={{ marginBottom: 0 }}>When you create an account</h3>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>Email address</b> and, if you sign up with email, a password. Your password is stored only as a secure hash by our login provider; we never see it.</li>
          <li><b>If you sign in with Google or Apple:</b> we receive your <b>email address</b>, your <b>name</b> and your <b>profile picture link</b> from that account. We do not receive your Google or Apple password, contacts, files, calendar or anything else.</li>
          <li><b>Your Hub profile:</b> the nickname (@handle) you choose, a colour, and your confirmation that you are 18 or older.</li>
          <li><b>2-step verification:</b> if you turn it on, the secret that links your authenticator app to your account, kept by our login provider.</li>
        </ul>
        <h3 style={{ marginBottom: 0 }}>When you use the Hub</h3>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>Things you post:</b> posts, replies, hearts, follows, session sign-ups, reports you send, and groups you join.</li>
          <li><b>Wallets:</b> public wallet addresses you link or create, and token pins and alerts you set up. If you create a wallet in the Hub, it is made by our wallet provider (Privy); we never see or store your private key or secret phrase.</li>
          <li><b>Payments:</b> if you buy a Pro or Assistant Pass with crypto, the transaction hash and the wallet it came from.</li>
          <li><b>Forms:</b> if you register interest in the AUTISTIK Fund or apply as a practitioner, the details you type in (such as name, email, country and, if you give it, phone number).</li>
          <li><b>Notifications:</b> if you allow push notifications, the technical address your browser gives us to deliver them.</li>
          <li><b>Assistant (Believer and Purity):</b> how many messages you send each day, so we can apply the daily limit. The content of your chats is not stored on our servers.</li>
        </ul>
        <h3 style={{ marginBottom: 0 }}>Automatically</h3>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>Visit counts:</b> the page you opened, a random browser id stored in a cookie, a one-way scrambled version of your IP address (the IP itself is never stored), your country, the kind of device (phone, tablet or computer) and the site that linked you here. Login and account pages are never counted.</li>
          <li><b>Security logs:</b> our hosting and login providers keep short-lived technical logs (such as IP address and browser type) to block abuse and attacks.</li>
        </ul>
        <h3 style={{ marginBottom: 0 }}>What stays on your device</h3>
        <p style={{ margin: 0 }}>Your battery check-ins and some display settings are kept in your own browser and are never sent to us.</p>
        <h3 style={{ marginBottom: 0 }}>What we never collect</h3>
        <p style={{ margin: 0 }}>We do not ask for, or store, medical records, diagnoses, your real name on your public profile, wallet secret phrases or private keys, or card details.</p>
      </div>

      <div className="card stack">
        <h2>2. How we use it</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li>To create your account, sign you in and keep it secure (including email codes and 2-step verification).</li>
          <li>To run the features you use: posting, following, sessions, wallets, token tools, alerts and the assistant.</li>
          <li>To send you emails you need, such as sign-up codes and password resets, and notifications you turned on.</li>
          <li>To give Pro and Assistant Pass holders their benefits, and to send airdrops to linked wallets.</li>
          <li>To keep the community safe: review reports, stop spam, enforce the <Link href="/safety">community guidelines</Link> and the 18+ rule.</li>
          <li>To understand, in total, how many people visit and which pages are useful.</li>
        </ul>
        <p style={{ margin: 0 }}>
          <b>Google and Apple sign-in data</b> (your email, name and picture) is used only to create and sign in to your AUTISTIK Hub account. Your
          email is used to contact you about your account. It is never shown to other members, never sold, never used for advertising, and never
          shared except with the service providers listed below that run the Hub for us.
        </p>
        <p style={{ margin: 0 }}>We do not sell your data. We do not show ads. We do not use your data to train AI models.</p>
      </div>

      <div className="card stack">
        <h2>3. Who can see it</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>Other members</b> see your nickname, colour, and what you post publicly. They never see your email address or real name.</li>
          <li><b>Admins</b> can see account details, linked wallets, reports and form entries when needed to run the Hub, send airdrops or keep it safe. Admin access is protected with 2-step verification.</li>
          <li><b>Anything on a blockchain</b> (such as wallet addresses and transactions) is public by nature, and we can&apos;t change or delete it.</li>
        </ul>
      </div>

      <div className="card stack">
        <h2>4. Service providers we share data with</h2>
        <p style={{ margin: 0 }}>We only share what each provider needs to do its job for us:</p>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>Supabase</b>: our database and login system (accounts, posts, settings).</li>
          <li><b>Vercel</b>: hosts the website and gives us your approximate country.</li>
          <li><b>Google</b> and <b>Apple</b>: only if you choose to sign in with them.</li>
          <li><b>Privy</b>: creates and secures in-Hub wallets.</li>
          <li><b>Anthropic</b>: powers the Believer and Purity assistant; your messages are sent to it to get a reply.</li>
          <li><b>Cloudflare Turnstile</b>: checks forms are filled in by people, not bots.</li>
          <li><b>Email delivery</b>: sends sign-up codes and account emails.</li>
          <li><b>Blockchain data services</b> (such as public RPC nodes, DexScreener, Moralis and Etherscan): look up public token and wallet information. They receive wallet addresses, not your account details.</li>
        </ul>
        <p style={{ margin: 0 }}>We may also share information if the law requires it, or to protect members from harm or fraud.</p>
      </div>

      <div className="card stack">
        <h2>5. Cookies</h2>
        <p style={{ margin: 0 }}>
          We use a small number of cookies: ones that keep you signed in, and one random id (&quot;hv&quot;) to count visits. We do not use
          advertising or cross-site tracking cookies.
        </p>
      </div>

      <div className="card stack">
        <h2>6. How long we keep it</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li>Account data and posts: until you delete your account or ask us to.</li>
          <li>Visit counts: deleted automatically after 180 days.</li>
          <li>Fund interest and practitioner applications: until the purpose is finished or you ask us to delete them.</li>
          <li>Security logs at our providers: usually a few days to a few weeks.</li>
        </ul>
      </div>

      <div className="card stack">
        <h2>7. Your choices and rights</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>See or copy</b> the data we hold about you.</li>
          <li><b>Correct</b> anything that is wrong.</li>
          <li><b>Delete</b> your account and the data linked to it.</li>
          <li><b>Turn off</b> push notifications, alerts and 2-step verification at any time in the Hub.</li>
          <li><b>Disconnect Google:</b> you can remove AUTISTIK Hub&apos;s access at <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">myaccount.google.com/connections</a>.</li>
        </ul>
        <p style={{ margin: 0 }}>
          To do any of these, email {mail} from the email address on your account. We reply within 30 days. Depending on where you live (for example
          the UK, EU or California) you may have further rights, including complaining to your local data protection authority.
        </p>
      </div>

      <div className="card stack">
        <h2>8. Security</h2>
        <p style={{ margin: 0 }}>
          Data is encrypted in transit (HTTPS) and at rest by our providers. Database rules let each member reach only their own private data, and
          optional 2-step verification protects accounts. No system is perfectly secure, so please use a strong password and turn on 2-step
          verification in <Link href="/security">Account security</Link>.
        </p>
      </div>

      <div className="card stack">
        <h2>9. Adults only</h2>
        <p style={{ margin: 0 }}>AUTISTIK Hub is for people aged 18 and over. We don&apos;t knowingly collect data from anyone younger. If you think a child has signed up, email {mail} and we&apos;ll remove the account.</p>
      </div>

      <div className="card stack">
        <h2>10. Changes and contact</h2>
        <p style={{ margin: 0 }}>
          If we change this policy we&apos;ll update the date at the top, and tell members on the Hub about important changes. Questions or requests:
          email {mail} or ask in our <a href={LINKS.telegram} target="_blank" rel="noopener noreferrer">Telegram</a>.
        </p>
      </div>
    </div>
  );
}
