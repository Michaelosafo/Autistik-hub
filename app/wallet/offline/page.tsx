import { redirect } from "next/navigation";

// Offline swap lives with the wallet in the menu; the swap itself runs on the Hyperfocus page's #swap section.
export default function OfflineSwapPage() {
  redirect("/hyperfocus#swap");
}
