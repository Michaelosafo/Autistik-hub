/**
 * The AUTISTIK wordmark: the name in big display letters with the infinity logo standing in for the first "I"
 * (AUT∞STIK). Screen readers read "AUTISTIK".
 */
import LogoMark from "@/components/LogoMark";

export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={"wordmark " + className} role="img" aria-label="AUTISTIK">
      <span aria-hidden="true">AUT</span>
      <span className="wm-logo" aria-hidden="true"><LogoMark size={64} title="" /></span>
      <span aria-hidden="true">STIK</span>
    </span>
  );
}
