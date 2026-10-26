import Link from "next/link";

export type HeroTone = "cyan" | "violet" | "gold" | "coral" | "green" | "rose";
export type HeroStat = [value: React.ReactNode, label: string];

/**
/* Board-style header (same look as the Board and Create a coin) used at the top of every main page: a kicker line, the title, a short line of text,
 * an optional Live badge, live numbers and an optional tool (a search box, buttons) inside the panel.
 */
export default function ProHero({ kicker, title, text, tone = "cyan", live, stats, link, children }: {
  /** `text` is one plain sentence under the title, like the Board and Create a coin. */
  kicker: string; title: React.ReactNode; text?: React.ReactNode; tone?: HeroTone; live?: string | false;
  stats?: HeroStat[]; link?: { href: string; text: React.ReactNode }; children?: React.ReactNode;
}) {
  return (
    <section className={`an-hero tone-${tone}`}>
      <div className="an-hero-top">
        <div>
          <div className="an-kicker">{kicker}</div>
          <h1>{title}</h1>
          {text && <p>{text}</p>}
        </div>
        {live && <div className="an-live"><i />{live}</div>}
      </div>
      {children}
      {!!stats?.length && (
        <div className="an-metrics" style={{ ["--n" as any]: stats.length }}>
          {stats.map(([v, l]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}
        </div>
      )}
      {link && <Link href={link.href} className="ln-ghost an-pro">{link.text}</Link>}
    </section>
  );
}
