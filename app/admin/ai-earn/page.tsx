import { redirect } from "next/navigation";

/** Earn was replaced by the Lobby. Old links land there. */
export default function AIEarnPage() { redirect("/admin/lobby"); }
