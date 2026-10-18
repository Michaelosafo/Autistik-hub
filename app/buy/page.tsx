import Link from "next/link";
import CopyCA from "@/components/CopyCA";
import SectionCards, { TOKEN_CARDS } from "@/components/SectionCards";
import ProHero from "@/components/ProHero";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { LINKS } from "@/lib/site";

export const metadata = {
  title: "Buy $AUTISTIK · AUTISTIK Hub",
  description: "How to buy $AUTISTIK on PancakeSwap, the official contract address, tokenomics and roadmap.",
};

const STEPS: { title: string; body: React.ReactNode }[] = [
  { title: "Get a wallet", body: <>Install a non-custodial wallet such as <a href="https://trustwallet.com" target="_blank" rel="noopener noreferrer">Trust Wallet</a> or <a href="https://metamask.io" target="_blank" rel="noopener noreferrer">MetaMask</a>. Write your seed phrase on paper and keep it secret. Nobody from AUTISTIK will ever ask for it.</> },
  { title: "Get BNB on BNB Smart Chain", body: <>Buy BNB on an exchange such as <a href="https://www.binance.com" target="_blank" rel="noopener noreferrer">Binance</a> and send it to your wallet on <b>BNB Smart Chain (BEP-20)</b>. Keep a little extra BNB to pay network fees.</> },
  { title: "Open PancakeSwap", body: <>Go to <a href={LINKS.pancakeswap} target="_blank" rel="noopener noreferrer">PancakeSwap</a> and connect your wallet. Check you are on BNB Smart Chain.</> },
  { title: "Paste the official contract", body: <>In the &quot;To&quot; box, paste the contract address below. Only use the address on this page or our official accounts. Fake tokens use the same name.</> },
  { title: "Swap BNB for $AUTISTIK", body: <>Enter how much BNB to spend and press Swap. $AUTISTIK has a 3% buy tax and 4% sell tax, so if the swap fails, raise slippage slightly (around 5%). Start with a small test amount.</> },
  { title: "See it in your wallet", body: <>If $AUTISTIK doesn&apos;t show up, use &quot;Import token&quot; in your wallet and paste the same contract address.</> },
];

const ALLOCATION = [
  { label: "Liquidity pool", pct: 40, amount: "40,000,000" },
  { label: "Burned at launch", pct: 30, amount: "30,000,000" },
  { label: "Development (chatbot, tools, audits, grants)", pct: 20, amount: "20,000,000" },
  { label: "Reserved for strategic burns", pct: 10, amount: "10,000,000" },
];

const ROADMAP = [
  { phase: "Phase 01", name: "Foundation", items: ["Token launch", "Website", "Community setup", "Social media presence", "Brand identity"] },
  { phase: "Phase 02", name: "Growth", items: ["Community expansion", "Art campaigns", "Creator collaborations", "Marketing campaigns", "DEX/CEX visibility", "Art competitions on X"] },
  { phase: "Phase 03", name: "Impact", items: ["Autism awareness campaigns", "Community initiatives", "Partnerships with credible organizations", "Transparent contributions to autism-focused causes"] },
];

export default function BuyPage() {
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <SectionCards items={TOKEN_CARDS} active="/buy" label="$AUTISTIK" />
      <ProHero tone="gold" kicker="$AUTISTIK · BNB SMART CHAIN" title="How to buy $AUTISTIK"
        text="Six steps, about ten minutes. Take your time, and ask in our Telegram if you get stuck."
        stats={[["100M", "total supply"], ["30%", "burned at launch"], ["3% / 4%", "buy / sell tax"], ["🔒 Locked", "liquidity"]]}>
        <div className="an-actions">
          <a className="btn primary" href={LINKS.pancakeswap} target="_blank" rel="noopener noreferrer">Buy on PancakeSwap</a>
          <a className="btn" href={LINKS.dexscreener} target="_blank" rel="noopener noreferrer">📈 Chart</a>
        </div>
      </ProHero>

      <div className="card stack">
        <h2>Official contract address</h2>
        <CopyCA address={TOKEN_ADDRESS} />
        <div className="row" style={{ gap: 6 }}>
          <a className="btn primary" href={LINKS.pancakeswap} target="_blank" rel="noopener noreferrer">Buy on PancakeSwap</a>
          <a className="btn" href={LINKS.dexscreener} target="_blank" rel="noopener noreferrer">View chart</a>
          <a className="btn" href={LINKS.bscscan} target="_blank" rel="noopener noreferrer">View on BscScan</a>
          <a className="btn" href={LINKS.lpLock} target="_blank" rel="noopener noreferrer">🔒 Liquidity lock certificate</a>
        </div>
      </div>

      <div className="card stack">
        <h2>Step by step</h2>
        <ol className="buy-steps">
          {STEPS.map((s, i) => (
            <li key={i}><b>{s.title}</b><p className="muted">{s.body}</p></li>
          ))}
        </ol>
        <div className="notice alert" style={{ fontSize: ".9em" }}><b>Never</b> share your seed phrase or private key with anyone, including people who say they are from AUTISTIK.</div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card stack">
          <h2>Tokenomics</h2>
          <table><tbody>
            <tr><th>Name</th><td>Autism Spectrum Disorder (ASD)</td></tr>
            <tr><th>Ticker</th><td>$AUTISTIK</td></tr>
            <tr><th>Chain</th><td>BNB Smart Chain (BEP-20)</td></tr>
            <tr><th>Total supply</th><td className="num">100,000,000 · fixed, no minting</td></tr>
            <tr><th>Tax</th><td>3% buy · 4% sell</td></tr>
            <tr><th>Liquidity</th><td>Locked 12 months</td></tr>
          </tbody></table>
          <div className="stack" style={{ gap: 10 }}>
            {ALLOCATION.map((a) => (
              <div key={a.label} className="alloc">
                <div className="row" style={{ justifyContent: "space-between", fontSize: ".9em" }}><span>{a.label}</span><b className="num">{a.pct}% · {a.amount}</b></div>
                <div className="alloc-bar" role="presentation"><i style={{ width: `${a.pct}%` }} /></div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".82em" }}>Tax is intended for charity. How it is used is at the project&apos;s discretion and is not guaranteed.</p>
        </div>

        <div className="card stack">
          <h2>Roadmap</h2>
          {ROADMAP.map((r) => (
            <div key={r.phase} className="stack" style={{ gap: 4 }}>
              <div className="label">{r.phase}</div>
              <h3>{r.name}</h3>
              <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: ".92em" }}>{r.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>

      <div className="card stack">
        <h2>Community</h2>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn" href={LINKS.telegram} target="_blank" rel="noopener noreferrer">Telegram</a>
          <a className="btn" href={LINKS.x} target="_blank" rel="noopener noreferrer">X</a>
          <a className="btn" href={LINKS.youtube} target="_blank" rel="noopener noreferrer">YouTube</a>
          <a className="btn" href={`mailto:${LINKS.email}`}>✉️ {LINKS.email}</a>
          <a className="btn small" href={LINKS.dev} target="_blank" rel="noopener noreferrer">Dev on X</a>
          <a className="btn small" href={LINKS.coDev} target="_blank" rel="noopener noreferrer">Co-dev on X</a>
          <a className="btn small" href={LINKS.whitepaper} target="_blank" rel="noopener noreferrer">Whitepaper (PDF)</a>
        </div>
        <p className="muted" style={{ fontSize: ".9em" }}>New to autism? Read <Link href="/autism">Understanding autism</Link>. Want to help autistic people directly? See the <Link href="/fund">AUTISTIK Fund</Link>.</p>
      </div>

      <p className="muted" style={{ fontSize: ".82em" }}>Nothing on this page is financial, legal or investment advice. $AUTISTIK is a community token and its price can go up or down a lot, including to zero. Only spend what you can afford to lose.</p>
    </div>
  );
}
