import Link from "next/link";
import ChatApp from "@/components/chat/ChatApp";
import BadgeApply from "@/components/BadgeApply";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chats · AUTISTIK Hub", description: "Chat with people you follow, make groups, and talk with everyone in the AUTISTIK group." };

export default async function ChatsPage({ searchParams }: { searchParams: { c?: string } }) {
  const user = await currentUser();
  let prof: any = null;
  if (user) prof = (await supabaseServer().from("profiles").select("is_team,is_verified").eq("id", user.id).maybeSingle()).data;
  return (
    <div className="stack chats-page">
      <header className="bd-top ln-top">
        <div>
          <h1>Chats</h1>
          <p className="muted">Message people you follow, make groups, and say hi in the AUTISTIK group. <span className="ch-legend"><b className="team">Gold</b> = team · <b className="ver">Green</b> = verified · <b>Black</b> = member</span></p>
        </div>
      </header>
      {!user ? (
        <div className="card stack" style={{ alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>Chats are for members. Sign in or join free to message people.</p>
          <Link className="btn primary" href="/login?next=/chats">Sign in / Join</Link>
        </div>
      ) : (
        <>
          <ChatApp me={user.id} open={/^[0-9a-f-]{36}$/i.test(searchParams.c || "") ? searchParams.c : undefined} />
          {!prof?.is_team && !prof?.is_verified && (
            <details className="card ch-verify">
              <summary><b>Get a green name</b> <small className="muted">Apply to be verified: your name shows in green with a ✓ everywhere.</small></summary>
              <div style={{ marginTop: 10 }}><BadgeApply verified={false} team={false} /></div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
