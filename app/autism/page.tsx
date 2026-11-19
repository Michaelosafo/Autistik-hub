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

/**
 * Long-form guide. There is no /hike route; this is the page that is mostly paragraphs,
 * headings and lists, so the reading rhythm lives here.
 */
export default function AutismPage() {
  return (
    <div className="read">
      <ProHero tone="rose" kicker="UNDERSTANDING AUTISM" title="Different wavelength. Same channel."
        text="A plain-language guide to what autism is, common misconceptions, and how to be supportive. For anyone who wants to understand."
        stats={[["~1 in 100", "children (WHO)"], ["Lifelong", "not an illness"], ["Spectrum", "not a scale"]]} />

      <section className="card prose" aria-labelledby="what-autism">
        <h2 id="what-autism">What autism actually is</h2>
        <p>Autism is a lifelong, natural difference in how the brain processes information, communicates and experiences the world. It is there from early life. It isn&apos;t something you catch, and it isn&apos;t something to cure.</p>
        <p>&quot;Spectrum&quot; doesn&apos;t mean a line from mild to severe. It means many traits that combine differently in each person, such as:</p>
        <div className="traits read-pills" style={{ ["--cs" as string]: "var(--violet-soft)" }}>{TRAITS.map((t) => <span key={t}>{t}</span>)}</div>
        <p>Two autistic people can look very different, and both are autistic.</p>
      </section>

      <section className="card prose" aria-labelledby="myths">
        <h2 id="myths">Common misconceptions worth retiring</h2>
        <div className="myths">
          {MYTHS.map((m) => (
            <article key={m.myth} className="myth">
              <h3>{m.myth}</h3>
              <p className="muted">{m.truth}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="read-split">
        <section className="card prose" aria-labelledby="facts">
          <h2 id="facts">Important facts</h2>
          <ul className="prose-list">{FACTS.map((f) => <li key={f}>{f}</li>)}</ul>
          <p className="muted"><b>A note on words:</b> some people say &quot;autistic person&quot;, others say &quot;person with autism&quot;. Use the words each person uses for themselves.</p>
        </section>
        <section className="card prose" aria-labelledby="support">
          <h2 id="support">How to be supportive</h2>
          <ul className="prose-list">{SUPPORT.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
      </div>

      <section className="card prose" aria-labelledby="learn-more">
        <h2 id="learn-more">Where to learn more</h2>
        <p>Autistic-led organisations and communities are the best place for first-hand, up-to-date views. They are more reliable than any single article, including this one.</p>
        <p>On the Hub, you can ask questions in the <Link href="/community?g=learn">Ask &amp; Learn</Link> group, join a <Link href="/sessions">live session</Link> with verified practitioners, or talk things through with <Link href="/companions">Believer or Purity</Link>.</p>
        <div className="read-actions">
          <Link className="btn primary" href="/community">Join the community</Link>
          <Link className="btn" href="/fund">AUTISTIK Fund</Link>
        </div>
      </section>

      <p className="read-note muted">This page is general information, not medical advice. If you need support right now, find a helpline near you at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</p>
    </div>
  );
}
