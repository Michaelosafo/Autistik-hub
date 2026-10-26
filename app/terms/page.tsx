import Link from "next/link";
import { LINKS } from "@/lib/site";

export const metadata = {
  title: "Terms of use · AUTISTIK Hub",
  description: "The rules for using AUTISTIK Hub (autistik.io): what it is, the risks of crypto, what we never do with your wallet, and how to reach us.",
};

const UPDATED = "26 October 2026";

/** Terms of use and risk notice. Plain words; read together with the privacy policy and the community guidelines. */
export default function Terms() {
  const mail = <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a>;
  const sec = (n: string, t: string, body: React.ReactNode) => (
    <div className="card stack"><h2>{n}. {t}</h2>{body}</div>
  );
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="card stack">
        <div className="label">Terms of use</div>
        <h1 style={{ margin: 0 }}>Using AUTISTIK Hub safely</h1>
        <p className="muted" style={{ margin: 0 }}>Last updated {UPDATED}</p>
        <p style={{ margin: 0 }}>
          AUTISTIK Hub (<a href="https://autistik.io">autistik.io</a>) is a community site for autistic adults and holders of the $AUTISTIK token,
          with tools for the BNB Chain, Ethereum, Solana and other networks. It is run by the AUTISTIK team (&quot;we&quot;, &quot;us&quot;). By using
          the site you agree to these terms, our <Link href="/privacy">privacy policy</Link> and the <Link href="/safety">community guidelines</Link>.
          Questions: {mail}.
        </p>
      </div>

      {sec("1", "Your wallet stays yours", <>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li><b>We never ask for your seed phrase, recovery words or private key.</b> Nobody from AUTISTIK will, on the site, by email, on Telegram or on X. Anyone who asks is a scammer.</li>
          <li>Connecting a wallet only shares your public address. Nothing moves unless you approve a transaction in your own wallet, and your wallet shows you exactly what it does first.</li>
          <li>We don&apos;t hold your coins. Swaps, staking, Susu savings, lockers and launches run on public smart contracts that you use directly from your wallet. Token approvals ask for the exact amount needed, not unlimited access.</li>
          <li>The built-in AUTISTIK wallet is created for you by Privy and only you can use it; we can&apos;t move its funds.</li>
        </ul>
      </>)}

      {sec("2", "Crypto is risky", <>
        <p style={{ margin: 0 }}>Prices can fall to zero. Tokens launched by community members are made by them, not by the AUTISTIK team, and may fail or be scams. Smart contracts can have bugs. Transactions on a blockchain can&apos;t be reversed. Only use money you can afford to lose, check every transaction before you approve it, and do your own research.</p>
        <p style={{ margin: 0 }}><b>Nothing on AUTISTIK Hub is financial, investment, legal or tax advice.</b> APRs, rewards and prices shown are estimates and can change at any time.</p>
      </>)}

      {sec("3", "Fees", <p style={{ margin: 0 }}>Some tools charge a small fee, always shown before you confirm: for example 0.3% on Launch Pad trades on BNB Chain and Ethereum, 0.5% on Solana launches and Hub swaps. Blockchain network fees are paid to the network, not to us. Susu savings have no AUTISTIK fee.</p>)}

      {sec("4", "Who can use it", <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
        <li>You must be 18 or older and allowed to use crypto services where you live.</li>
        <li>Don&apos;t use the site for anything illegal, to launch tokens that copy another project&apos;s name or logo, to mislead people, or to harm the community. We may hide content, remove listings or close accounts that do.</li>
      </ul>)}

      {sec("5", "Official links only", <>
        <p style={{ margin: 0 }}>The only official site is <b>https://autistik.io</b>. Official channels: <a href={LINKS.x} target="_blank" rel="noopener noreferrer">X (@Autistik_)</a>, <a href={LINKS.telegram} target="_blank" rel="noopener noreferrer">Telegram</a> and {mail}. Look-alike sites and accounts are not us; please report them to {mail}.</p>
      </>)}

      {sec("6", "No guarantees", <p style={{ margin: 0 }}>The site is provided as it is. We work hard to keep it safe and running, but we can&apos;t promise it will always be available or free of errors, and to the extent the law allows we aren&apos;t liable for losses from using it, from blockchain networks, from third-party wallets, DEXs or tokens, or from your own mistakes.</p>)}

      {sec("7", "Changes and contact", <p style={{ margin: 0 }}>We may update these terms; the date at the top shows the latest version. Security issues: {mail} (see <a href="/.well-known/security.txt">security.txt</a>). Everything else: {mail}.</p>)}
    </div>
  );
}
