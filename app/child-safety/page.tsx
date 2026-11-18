import { LINKS } from "@/lib/site";

export const metadata = { title: "Child Safety Standards · AUTISTIK Hub" };

/** Published standards against child sexual abuse and exploitation (CSAE), as Google Play requires for social apps. */
export default function ChildSafety() {
  return (
    <div className="stack" style={{ maxWidth: 740 }}>
      <div className="page-head">
        <div className="label">AUTISTIK Hub</div>
        <h1>Child Safety Standards</h1>
        <p className="muted">Last updated 18 November 2026</p>
      </div>

      <div className="card stack">
        <h2>Zero tolerance</h2>
        <p style={{ margin: 0 }}>
          AUTISTIK Hub has zero tolerance for child sexual abuse and exploitation (CSAE) and child sexual abuse material
          (CSAM). Any content, message, profile, live session or behaviour that sexualises, grooms, exploits or endangers a
          child is strictly prohibited, anywhere in the app or on autistik.io.
        </p>
        <p style={{ margin: 0 }}>The Hub is for adults aged 18 and over. Accounts that belong to anyone under 18 are removed.</p>
      </div>

      <div className="card stack">
        <h2>What is not allowed</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
          <li>Sharing, requesting, linking to or producing child sexual abuse material of any kind, real or generated.</li>
          <li>Grooming, or any attempt to build contact with a minor for sexual purposes.</li>
          <li>Sexual or romantic content involving or directed at minors.</li>
          <li>Sextortion, trafficking, or any other exploitation of children.</li>
          <li>Using the Hub to find, contact or arrange to meet children.</li>
        </ul>
      </div>

      <div className="card stack">
        <h2>How to report</h2>
        <p style={{ margin: 0 }}>
          Use the <b>Report</b> option on any post, message, profile or live session inside the app, or email{" "}
          <a href={`mailto:${LINKS.email}`}><b>{LINKS.email}</b></a> with &quot;Child safety&quot; in the subject. Admins review
          every child-safety report as a priority.
        </p>
        <p style={{ margin: 0 }}>If a child is in immediate danger, contact your local police or emergency services first.</p>
      </div>

      <div className="card stack">
        <h2>What we do</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
          <li>Remove the content and permanently ban the accounts involved.</li>
          <li>Preserve the evidence and report CSAM to the National Center for Missing &amp; Exploited Children (NCMEC) and to the relevant national authorities, as the law requires.</li>
          <li>Cooperate fully with law enforcement investigations.</li>
          <li>Comply with all applicable child safety laws in the countries where the Hub is available.</li>
        </ul>
      </div>

      <div className="card stack">
        <h2>Child safety contact</h2>
        <p style={{ margin: 0 }}>
          Our designated contact for child safety matters, including questions from Google Play and law enforcement:{" "}
          <a href={`mailto:${LINKS.email}`}><b>{LINKS.email}</b></a>.
        </p>
        <p className="muted" style={{ margin: 0 }}>See also our <a href="/safety">Safety</a> page and <a href="/privacy">privacy policy</a>.</p>
      </div>
    </div>
  );
}
