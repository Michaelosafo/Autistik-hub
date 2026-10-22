import { LINKS } from "@/lib/site";

const APPS: { name: string; note: string; ios: string; android: string }[] = [
  { name: "Google Authenticator", note: "Simple, free. Turn on Google backup so a new phone gets your codes.", ios: "https://apps.apple.com/app/google-authenticator/id388497605", android: "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" },
  { name: "Microsoft Authenticator", note: "Free. Backs up to your Microsoft or iCloud account.", ios: "https://apps.apple.com/app/microsoft-authenticator/id983156458", android: "https://play.google.com/store/apps/details?id=com.azure.authenticator" },
  { name: "2FAS", note: "Free and open source, no account needed.", ios: "https://apps.apple.com/app/2fas-auth/id1217793794", android: "https://play.google.com/store/apps/details?id=com.twofasapp" },
];

/** Step-by-step help for adding an authenticator app. Plain words, one action per step. */
export default function AuthenticatorGuide() {
  return (
    <section className="card stack" aria-labelledby="guide-h">
      <h2 id="guide-h">How to add an authenticator app</h2>
      <p className="muted" style={{ margin: 0 }}>
        An authenticator app makes a new 6-digit code every 30 seconds. When you sign in, the Hub asks for your password <b>and</b> the code.
        Someone who steals your password still can&apos;t get in without your phone. It&apos;s optional, but we strongly recommend it,
        especially if you hold coins or use the wallet.
      </p>

      <h3 style={{ marginBottom: 0 }}>1. Install an app on your phone</h3>
      <p className="muted" style={{ margin: 0 }}>Pick one. They all work the same way.</p>
      <div className="stack" style={{ gap: 8 }}>
        {APPS.map((a) => (
          <div key={a.name} className="notice stack" style={{ gap: 4 }}>
            <b>{a.name}</b>
            <span className="muted" style={{ fontSize: ".9em" }}>{a.note}</span>
            <span className="row" style={{ gap: 12, fontSize: ".9em" }}>
              <a href={a.ios} target="_blank" rel="noopener noreferrer">iPhone (App Store)</a>
              <a href={a.android} target="_blank" rel="noopener noreferrer">Android (Google Play)</a>
            </span>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 0 }}>2. Add AUTISTIK Hub to the app</h3>
      <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
        <li><b>On a computer:</b> open the app on your phone, tap <b>+</b> (or <b>Add account</b>), choose <b>Scan a QR code</b>, and point the camera at the square code on this page.</li>
        <li><b>On your phone:</b> tap <b>Open in my authenticator app</b>. If nothing happens, tap <b>Copy the key</b>, then in the app choose <b>Enter a setup key</b> and paste it. Name it <b>AUTISTIK Hub</b> and choose <b>Time based</b>.</li>
      </ol>

      <h3 style={{ marginBottom: 0 }}>3. Type the code to finish</h3>
      <p style={{ margin: 0 }}>The app now shows <b>AUTISTIK Hub</b> with a 6-digit number. Type that number into the box on this page and press <b>Turn it on</b>. That&apos;s it.</p>

      <h3 style={{ marginBottom: 0 }}>Each time you sign in</h3>
      <p style={{ margin: 0 }}>Enter your email and password as usual. Then open the app and type the 6-digit code it shows for AUTISTIK Hub.</p>

      <h3 style={{ marginBottom: 0 }}>If something goes wrong</h3>
      <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
        <li><b>&quot;That code didn&apos;t work&quot;:</b> codes only last 30 seconds, so type the newest one. Check your phone&apos;s date and time are set to <b>automatic</b>.</li>
        <li><b>New phone:</b> turn on the app&apos;s backup before you switch, or add a second authenticator (a tablet or second phone) on the Account security page.</li>
        <li><b>Lost your phone with no backup:</b> email <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a> from your account&apos;s email address. We check it&apos;s really you before resetting it, which can take a few days.</li>
        <li>We will <b>never</b> ask you for your code by message, email or phone call. Anyone who asks is trying to break into your account.</li>
      </ul>
    </section>
  );
}
