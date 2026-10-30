import Board, { type Tab } from "@/components/Board";
import { getBoard } from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Board · AUTISTIK" };

/** Every coin launched on AUTISTIK, live, with moving ranks and a Create button. ?tab=trending|listed|new|mcap|gainers */
// Kept here (not imported from the client component) so the server can check it.
const TABS: Tab[] = ["trending", "listed", "new", "mcap", "gainers"];
const isTab = (t: unknown): t is Tab => TABS.includes(t as Tab);

export default async function BoardPage({ searchParams }: { searchParams: { tab?: string } }) {
  const board = await getBoard(200).catch(() => []);
  return <Board initial={board} initialTab={isTab(searchParams?.tab) ? searchParams.tab : "trending"} />;
}
