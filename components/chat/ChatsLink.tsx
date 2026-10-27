"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** The Chats row in your panel, with a dot when a chat has new messages. */
export default function ChatsLink({ onGo }: { onGo?: () => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data } = await sb.from("chat_members").select("last_read_at,chat:chats(last_at,last_text)").eq("user_id", user.id);
      setUnread(((data || []) as any[]).filter((r) => r.chat?.last_text && Date.parse(r.chat.last_at) > Date.parse(r.last_read_at) + 1000).length);
    })();
  }, []);
  return (
    <Link href="/chats" className="mp-sec mad mad-link ch-link" onClick={onGo} aria-label="Open Chats">
      <span className="mad-head">
        <span className="mad-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        </span>
        <span className="mad-t"><b>Chats</b><small>Message people you follow, groups, the AUTISTIK group</small></span>
        {unread > 0 && <em className="mad-badge">{unread > 9 ? "9+" : unread}</em>}
        <i className="mad-go" aria-hidden="true">›</i>
      </span>
    </Link>
  );
}
