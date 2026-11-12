"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  if (!client) {
    client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Keep the live connection's heartbeat in a background worker: phones and background tabs slow page timers
      // down, the heartbeat was missed, and people dropped out of lives after a few minutes.
      realtime: { worker: true, heartbeatIntervalMs: 15_000 } as any,
    });
  }
  return client;
}
