import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/lib/auth";
import { oauthProviders } from "@/lib/auth-providers";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · AUTISTIK Hub" };

export default async function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string; mode?: string } }) {
  const next = safeNext(searchParams.next);
  if (await currentUser()) redirect(next);
  const mode = searchParams.mode === "join" ? "join" : searchParams.mode === "forgot" ? "forgot" : "signin";
  return <LoginForm next={next} initialError={searchParams.error || ""} initialMode={mode} providers={await oauthProviders()} />;
}
