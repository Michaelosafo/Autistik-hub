import VideoButton from "@/components/VideoButton";

// Walkthrough video: a "Watch how" button that opens it in a window. Nothing sits on the page or loads before.
export default function HowToVideo({ title, src, poster, captions, minutes }: { title: string; src: string; poster: string; captions: string; minutes: number }) {
  return <div className="ln-top-r"><VideoButton label="Watch how" title={title} src={src} poster={poster} captions={captions} minutes={minutes} /></div>;
}
