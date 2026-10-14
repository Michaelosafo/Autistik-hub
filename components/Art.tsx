import ART from "@/lib/art";

type Kind =
  | { kind: "hero" } | { kind: "stage" }
  | { kind: "group"; id: string }
  | { kind: "session"; type: string }
  | { kind: "portrait"; person: string; bg: string }
  | { kind: "believer" } | { kind: "purity" };

function svgFor(p: Kind): string {
  switch (p.kind) {
    case "hero": return ART.hero();
    case "stage": return ART.stage();
    case "group": return ART.group(p.id);
    case "session": return ART.session(p.type);
    case "portrait": return ART.portrait(p.person, p.bg);
    case "believer": return ART.believer();
    case "purity": return ART.purity();
  }
}

/** Renders one of the Hub's original illustrations, or a real photo when `photo` is given. */
export default function Art(props: Kind & { className?: string; photo?: string; alt?: string; style?: React.CSSProperties }) {
  const { className = "art", photo, alt, style } = props;
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <div className={className} style={style}><img src={photo} alt={alt || ""} loading="lazy" /></div>;
  }
  return <div className={className} style={style} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: svgFor(props) }} />;
}
