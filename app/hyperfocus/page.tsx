import { cookies, headers } from "next/headers";
import { APP_COOKIE } from "@/lib/android-app";
import HFBoot from "./HFBoot";
import { HF_CSS, HF_MARKUP } from "./markup";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Hyperfocus GP · Play · AUTISTIK Hub",
  description: "Race every holder of a coin in 3D, race your friends, or play to win $AUTISTIK.",
};

/**
 * Play: Hyperfocus GP, the 3D race. The page shows only the race; the wallet is its own page (/wallet) and the
 * offline swap opens from there (/wallet/offline, which lands on this page's #swap section).
 * The game is plain JavaScript (public/hyperfocus), started by HFBoot.
 */
export default function HyperfocusPage() {
  const nonce = headers().get("x-nonce") ?? undefined;
  // In the Google Play app: no paid races (Play's real-money gaming rules); free play and token races stay.
  const app = cookies().get(APP_COOKIE)?.value === "android";
  const markup = app ? HF_MARKUP
    .replace("Race every holder of a coin in 3D, race your friends, or play to win $AUTISTIK.", "Race every holder of a coin in 3D, or race your friends.")
    .replace("Free play, play to win $AUTISTIK, or race a real token\u2019s holders.", "Free play, or race a real token\u2019s holders.")
    .replace("Free play, play to win $AUTISTIK, or race a real token’s holders.", "Free play, or race a real token’s holders.") : HF_MARKUP;
  return (
    <>
      <h1 className="sr-only">Hyperfocus GP</h1>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Russo+One&family=Figtree:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" />
      <style dangerouslySetInnerHTML={{ __html: HF_CSS }} />
      {app && <style dangerouslySetInnerHTML={{ __html: '.hf .mcard[data-flow="paid"],.hf [data-step="paid"],.hf #paidOv{display:none!important}' }} />}
      <div className="hf" dangerouslySetInnerHTML={{ __html: markup }} suppressHydrationWarning />
      <HFBoot nonce={nonce} />
    </>
  );
}
