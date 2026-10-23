// Screen-recorded walkthrough with captions. Loads nothing until the person presses play.
export default function HowToVideo({ title, src, poster, captions, minutes }: { title: string; src: string; poster: string; captions: string; minutes: number }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <b>🎬 {title}</b>
        <span className="muted">{minutes} min · captions on</span>
      </div>
      <video controls preload="none" playsInline poster={poster} style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "16 / 9" }}>
        <source src={src} type="video/mp4" />
        <track kind="captions" src={captions} srcLang="en" label="English" default />
        Your browser can&apos;t play this video.
      </video>
    </div>
  );
}
