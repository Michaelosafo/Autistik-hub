import { headers } from "next/headers";
import HFBoot from "./HFBoot";
import { HF_CSS, HF_MARKUP } from "./markup";

export const metadata = {
  title: "Hyperfocus GP · AUTISTIK Hub",
  description: "The AUTISTIK game arena: race every holder of a token in 3D, with friends, and swap tokens offline.",
};

/** Hyperfocus GP, the game arena. The game itself is plain JavaScript (public/hyperfocus), started by HFBoot. */
export default function HyperfocusPage() {
  const nonce = headers().get("x-nonce") ?? undefined;
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Russo+One&family=Figtree:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" />
      <style dangerouslySetInnerHTML={{ __html: HF_CSS }} />
      <div className="hf" dangerouslySetInnerHTML={{ __html: HF_MARKUP }} suppressHydrationWarning />
      <HFBoot nonce={nonce} />
    </>
  );
}
