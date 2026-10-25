import Board from "@/components/Board";
import { getBoard } from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Board · AUTISTIK" };

/** Every coin launched on AUTISTIK, live, with moving ranks and a Create button. */
export default async function BoardPage() {
  const board = await getBoard(200).catch(() => []);
  return <Board initial={board} />;
}
