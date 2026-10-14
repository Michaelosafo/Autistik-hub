"use client";
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://not-configured.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "not-configured"
    );
  }
  return client;
}
