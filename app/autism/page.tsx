import Link from "next/link";
import ProHero from "@/components/ProHero";

export const metadata = {
  title: "Understanding autism · AUTISTIK Hub",
  description: "A plain-language guide to what autism is, common misconceptions, and how to be supportive.",
};

const MYTHS = [
  { myth: "“Everyone is a little autistic.”", truth: "Liking routine isn't autism. Autism is a specific neurological difference." },
  { myth: "“Autistic people lack empathy.”", truth: "Many autistic people feel empathy very strongly. They may show it or process it differently." },
  { myth: "“You can tell just by looking.”", truth: "There is no autistic “look”. Many autistic people mask their traits, and that costs them a lot of energy." },
  { myth: "“It only affects children.”", truth: "Autistic children grow up to be autistic adults. Support needs can change over time." },
];

const FACTS = [
  "Autism is a developmental and neurological difference, not a disease or an injury.",
  "Support needs range from very little to a lot, and can change with the place and situation.",
  "Sensitivity to light, sound, texture or touch is common and can shape daily life.",
  "Many autistic people describe their thinking as different, not less.",
];

const SUPPORT = [
  "Listen to how a person describes their own experience instead of relying on stereotypes.",
  "Respect sensory and communication preferences. Some people prefer direct words; others need more time to process.",
  "Don't assume one approach suits everyone.",
  "Support autistic-led spaces and organisations.",
  "Make small changes that help: quieter spaces, advance notice of changes, and written information alongside spoken.",
];

const TRAITS = ["Communication style", "Sensory processing", "Focus and interests", "Routine and predictability"];

export default function AutismPage() {
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <ProHero tone="rose" kicker="UNDERSTANDING AUTISM" title="Different wavelength. Same channel."
        text="A plain-language guide to what autism is, common misconceptions, and how to be supportive. For anyone who wants to understand."
        stats={[["~1 in 100", "children (WHO)"], ["Lifelong", "not an illness"], ["Spectrum", "not a scale"]]} />

      <div className="card stack">
        <h2>What autism actually is</h2>
        <p>Autism is a lifelong, natural difference in how the brain processes information, communicates and experiences the world. It is there from early life. It isn&apos;t something you catch, and it isn&apos;t something to cure.</p>
        <p>&quot;Spectrum&quot; doesn&apos;t mean a line from mild to severe. It means many traits that combine differently in each person, such as:</p>
        <div className="traits" style={{ marginTop: 0, ["--cs" as any]: "var(--violet-soft)" }}>{TRAITS.map((t) => <span key={t}>{t}</span>)}</div>
        <p>Two autistic people can look very different, and both are autistic.</p>
      </div>

      <div className="card stack">
        <h2>Common misconceptions worth retiring</h2>
        <div className="grid2" style={{ gap: 12 }}>
          {MYTHS.map((m) => (
            <div key={m.myth} className="stack" style={{ gap: 4, padding: 14, borderRadius: 12, background: "var(--surface-2)" }}>
              <b>{m.myth}</b>
              <p className="muted" style={{ fontSize: ".94em" }}>{m.truth}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h2>Important facts</h2>
          <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>{FACTS.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="muted" style={{ fontSize: ".9em" }}><b>A note on words:</b> some people say &quot;autistic person&quot;, others say &quot;person with autism&quot;. Use the words each person uses for themselves.</p>
        </div>
        <div className="card stack">
          <h2>How to be supportive</h2>
          <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>{SUPPORT.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      </div>

      <div className="card stack">
        <h2>Where to learn more</h2>
        <p>Autistic-led organisations and communities are the best place for first-hand, up-to-date views. They are more reliable than any single article, including this one.</p>
        <p>On the Hub, you can ask questions in the <Link href="/community?g=learn">Ask &amp; Learn</Link> group, join a <Link href="/sessions">live session</Link> with verified practitioners, or talk things through with <Link href="/companions">Believer or Purity</Link>.</p>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn primary" href="/community">Join the community</Link>
          <Link className="btn" href="/fund">AUTISTIK Fund</Link>
        </div>
      </div>

      <p className="muted" style={{ fontSize: ".82em" }}>This page is general information, not medical advice. If you need support right now, find a helpline near you at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</p>
    </div>
  );
}
