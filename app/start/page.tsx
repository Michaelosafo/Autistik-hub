import Link from "next/link";
import ProHero from "@/components/ProHero";

export const metadata = { title: "Start here · AUTISTIK Hub", description: "New to AUTISTIK Hub or to crypto? Pick what you want to do and we show you how, in plain words." };

const GOALS: { title: string; text: string; href: string; cta: string }[] = [
  { title: "Buy a coin", text: "Pick a coin, see if it looks safe, and buy with $5 or more. Your coins stay in your own wallet.", href: "/wallet", cta: "Open Wallet" },
  { title: "Check if a coin is safe", text: "Paste any coin address to see who holds it, the developer's wallet, taxes and warnings.", href: "/analytics", cta: "Open Analytics" },
  { title: "Launch my own coin", text: "Give it a name and ticker, sign once, and it goes live with its liquidity locked.", href: "/launchpad/new", cta: "Launch a coin" },
  { title: "Lock liquidity or tokens", text: "Lock your coin's pool money (or team tokens) until a date, so buyers know it can't be pulled.", href: "/lockers", cta: "Open Lockers" },
  { title: "Find fast-moving coins", text: "See coins with sudden volume, with a suggested buy range and when to take profit.", href: "/momentum", cta: "Open Momentum" },
  { title: "See what's trending", text: "Coins people are buying and watching right now, and coins launched here.", href: "/launchpad", cta: "Open Trending" },
  { title: "Buy $AUTISTIK", text: "The community coin. The official address, how to buy, and where the money goes.", href: "/buy", cta: "How to buy" },
  { title: "Earn rewards", text: "Take part (post, join sessions) and link your wallet to get airdrops each round.", href: "/rewards", cta: "My rewards" },
  { title: "Talk to someone", text: "Chat with Believer or Purity any time, join a group, or come to a live session.", href: "/companions", cta: "Start a chat" },
  { title: "Learn about autism", text: "Plain facts, common myths and how to be supportive.", href: "/autism", cta: "Learn" },
];

const WORDS: [string, string][] = [
  ["Wallet", "Your crypto account. You hold its key, so only you can move your coins. Never share your seed phrase or private key with anyone."],
  ["Seed phrase", "The 12 or 24 secret words that unlock your wallet. Anyone who has them can take everything. AUTISTIK will never ask for them."],
  ["Network (chain)", "The blockchain a coin lives on, like BNB Chain or Solana. Always send coins on the same network they came from."],
  ["Gas / network fee", "A small fee paid to the network for each transaction, in BNB, ETH or SOL. Keep a little for this."],
  ["Contract address (CA)", "A coin's unique ID. Names can be copied by scammers; the address can't. Always check it."],
  ["Liquidity / pool", "The money in a coin's trading pool. More liquidity means easier buying and selling and steadier prices."],
  ["LP token", "Proof of the money someone put in a pool. Locking LP tokens means that money can't be pulled out (no rug pull)."],
  ["Lock", "Tokens put away until a date. Nobody, not even the person who locked them, can take them out early."],
  ["Rug pull", "When a coin's creator pulls the pool money out and the price crashes to zero. Locked liquidity protects against this."],
  ["Honeypot", "A scam coin you can buy but never sell. AUTISTIK checks for this and blocks buying."],
  ["Tax", "A % some coins take on each buy or sell. High taxes (10%+) eat your money."],
  ["Slippage", "How far the price may move while your trade goes through. We set it for you."],
  ["Market cap", "Price × number of coins. Small market caps can grow faster, and fall faster."],
  ["Limit order", "Buy or sell automatically when the price reaches a number you choose."],
  ["Stop-loss", "Sell automatically if the price falls to a number you choose, to limit a loss."],
  ["Airdrop", "Free coins sent to wallets, for example as a reward for taking part."],
];

export default function StartPage() {
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <ProHero tone="green" kicker="START HERE" title="What do you want to do?" text="Everything on AUTISTIK Hub, explained simply. Pick one and we take you there. Each page also has a short How it works guide at the top." />
      <div className="start-grid">
        {GOALS.map((g) => (
          <Link key={g.href} href={g.href} className="start-card">
            <b>{g.title}</b>
            <span>{g.text}</span>
            <em>{g.cta} →</em>
          </Link>
        ))}
      </div>
      <section className="card stack" style={{ gap: 10 }}>
        <h2 style={{ margin: 0 }}>Crypto words, in plain English</h2>
        <dl className="start-words">{WORDS.map(([w, d]) => <div key={w}><dt>{w}</dt><dd>{d}</dd></div>)}</dl>
      </section>
      <section className="card stack" style={{ gap: 6 }}>
        <h2 style={{ margin: 0 }}>Stay safe</h2>
        <ul className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
          <li>Never share your seed phrase or private key. Nobody from AUTISTIK will ever ask for it.</li>
          <li>Start small. New coins can lose most of their value in minutes.</li>
          <li>Only use the official $AUTISTIK address from the Buy page.</li>
          <li>If someone messages you offering to trade for you or &quot;fix&quot; your wallet, it&apos;s a scam.</li>
        </ul>
        <Link href="/safety">More on safety and privacy →</Link>
      </section>
    </div>
  );
}
