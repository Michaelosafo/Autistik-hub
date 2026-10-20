import { redirect } from "next/navigation";

// The Trade tab was folded into Perps; old links land there.
export default function TradePage() {
  redirect("/perps");
}
