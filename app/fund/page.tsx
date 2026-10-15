import FundForm from "@/components/FundForm";
import SectionTabs, { TOKEN_TABS } from "@/components/SectionTabs";

export const metadata = {
  title: "AUTISTIK Fund · AUTISTIK Hub",
  description: "Funded by the community, built for individuals. Register your interest in the AUTISTIK Fund.",
};

const FAQ = [
  { q: "Is the fund open?", a: "Not yet. The fund is not currently open for donations or applications. Register your interest and we'll email you when it opens." },
  { q: "Is registering an application?", a: "No. It doesn't commit you to anything and doesn't guarantee funding. It just lets us contact you first." },
  { q: "Can I register for someone else?", a: "Yes. Parents, guardians and caregivers can register on behalf of an autistic person. Tick the box on the form." },
  { q: "What could the fund pay for?", a: "Things that make everyday life better for autistic people, such as therapy, equipment, education and everyday essentials." },
  { q: "Who decides?", a: "AUTISTIK is a community-driven project, not a registered charity. Funding decisions are made by the AUTISTIK team at its sole discretion, and decisions are final." },
  { q: "Where does the money come from?", a: "A portion of $AUTISTIK trading activity on BNB Chain is set aside for the fund." },
  { q: "What happens to my details?", a: "We keep them only to contact you about the fund. Only Hub admins can see them, and they are never put on the blockchain. Ask us any time to delete them." },
];

export default function FundPage() {
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <SectionTabs tabs={TOKEN_TABS} active="/fund" label="$AUTISTIK" />
      <div className="page-head">
        <div className="label">AUTISTIK Fund · BNB Chain</div>
        <h1>Funded by the community, built for individuals</h1>
        <p className="muted">A portion of $AUTISTIK trading activity is set aside to support people on the autism spectrum with therapy, equipment, education and everyday essentials.</p>
      </div>

      <div className="notice warn">The fund is <b>not open yet</b> for donations or applications. You can register your interest below.</div>

      <div className="grid2" id="about" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h2>Who it&apos;s for</h2>
          <p>Individuals on the autism spectrum. Parents, guardians and caregivers can register on their behalf.</p>
        </div>
        <div className="card stack">
          <h2>What it can help with</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Therapy</li>
            <li>Equipment</li>
            <li>Education</li>
            <li>Everyday essentials</li>
          </ul>
        </div>
      </div>

      <FundForm />

      <div className="card stack" id="faq">
        <h2>Questions</h2>
        {FAQ.map((x) => (
          <details key={x.q}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>{x.q}</summary>
            <p className="muted" style={{ marginTop: 6 }}>{x.a}</p>
          </details>
        ))}
      </div>

      <p className="muted" style={{ fontSize: ".82em" }}>AUTISTIK is a community-driven project, not a registered charity. Registering doesn&apos;t guarantee funding. We will never ask you for a seed phrase, private key or payment to register.</p>
    </div>
  );
}
