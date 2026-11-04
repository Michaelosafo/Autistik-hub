import { redirect } from "next/navigation";

// autistik.io/tik opens TIK (the feed lives at /mood).
export default function TikPage({ searchParams }: { searchParams: { tik?: string } }) {
  const t = searchParams.tik && /^[0-9a-f-]{36}$/i.test(searchParams.tik) ? `?tik=${searchParams.tik}` : "";
  redirect("/mood" + t);
}
