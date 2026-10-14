/* eslint-disable @next/next/no-img-element */
export default function TokenLogo({ src, symbol, big }: { src?: string | null; symbol: string; big?: boolean }) {
  const cls = "tlogo" + (big ? " big" : "");
  return src ? <img className={cls} src={src} alt="" loading="lazy" /> : <span className={cls} aria-hidden="true">{symbol.slice(0, 2)}</span>;
}
