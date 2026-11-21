import { redirect } from "next/navigation";

/** The Game arena was removed; old links go to the scanner. */
export default function ArenaGone() {
  redirect("/analytics");
}
