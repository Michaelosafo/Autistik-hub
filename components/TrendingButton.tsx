import Link from "next/link";

/** The small 🔥 Trending pill in every menu (website, three-column and App layouts): opens the Board on Trending. */
export default function TrendingButton({ className = "" }: { className?: string }) {
  return (
    <Link href="/board?tab=trending" className={"trend-btn " + className} title="Coins trending on the Board right now">
      <span aria-hidden="true">🔥</span><span>Trending</span>
    </Link>
  );
}
