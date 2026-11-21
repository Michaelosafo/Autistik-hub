import { redirect } from "next/navigation";

/** The Game arena was removed; an old match link opens that token in the scanner. */
export default function ArenaMatchGone({ params }: { params: { chain: string; token: string } }) {
  redirect(`/analytics?chain=${encodeURIComponent(params.chain)}&token=${encodeURIComponent(params.token)}`);
}
