import { LINKS } from "@/lib/site";
import ProHero from "@/components/ProHero";

export const metadata = { title: "Safety & privacy · AUTISTIK Hub" };

export default function Safety() {
  return (
    <div className="stack" style={{ maxWidth: 740 }}>
      <ProHero tone="green" kicker="SAFETY & PRIVACY" title="How the Hub keeps you safe"
        text="Your health stays private, your name stays hidden, and nobody from AUTISTIK will ever ask for your seed phrase."
        stats={[["0", "health data on-chain"], ["Hub names", "no real names"], ["18+", "adults only"]]} />
      <div className="card stack">
        <h2>Our promises</h2>
        <p className="muted" style={{ margin: 0 }}>The full details are in our <a href="/privacy">privacy policy</a>.</p>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
          <li>Nothing about your health, diagnosis or feelings is ever put on the blockchain.</li>
          <li>You get a Hub name. Your real name and email are never shown to other members.</li>
          <li>Chats with Believer and Purity are not stored on our servers.</li>
          <li>Your battery check-ins stay on your own device.</li>
          <li>Your wallet is only visible to you and the admins, for sending airdrops.</li>
          <li>If you register interest in the AUTISTIK Fund, your name, email, country and phone (if you give it) are only seen by admins and only used to contact you about the fund. Ask in Telegram or email <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a> and we&apos;ll delete them.</li>
          <li>The Hub is for adults aged 18 and over.</li>
        </ul>
      </div>
      <div className="card stack">
        <h2>Community guidelines</h2>
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
          <li>Respect every way of being autistic. No &quot;you don&apos;t seem autistic&quot;.</li>
          <li>Autism is not a disease. No talk of &quot;cures&quot;, and no selling treatments to members.</li>
          <li>Use content notes for heavy topics like self-harm, abuse or meltdowns.</li>
          <li>No price talk, shilling or financial promises in group channels.</li>
          <li>Don&apos;t share other people&apos;s private information.</li>
          <li>Report anything that feels wrong. Admins review every report.</li>
        </ol>
      </div>
      <div className="card stack">
        <h2>About Believer and Purity</h2>
        <p>Believer and Purity are AIs. They can help you think things through, plan, practise conversations, understand social situations and draw pictures. They can&apos;t diagnose you, prescribe anything, or replace a professional. They can make mistakes.</p>
      </div>
      <div className="notice alert"><b>If you&apos;re thinking about hurting yourself or you&apos;re in danger:</b> call your local emergency number now, or find a free, confidential helpline in your country at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>. You can also reach out to someone you trust.</div>
      <div className="card stack">
        <h2>Contact us</h2>
        <p style={{ margin: 0 }}>Questions, reports or partnerships: email <a href={`mailto:${LINKS.email}`}><b>{LINKS.email}</b></a> or ask in our <a href={LINKS.telegram} target="_blank" rel="noopener noreferrer">Telegram</a>.</p>
        <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>We will never ask for your wallet&apos;s secret phrase or private key. Anyone who does is a scammer, even if they say they&apos;re from AUTISTIK.</p>
      </div>
      <p className="muted" style={{ fontSize: ".85em" }}>$AUTISTIK is a community token on BNB Chain. Nothing on this site is financial, legal or investment advice.</p>
    </div>
  );
}
