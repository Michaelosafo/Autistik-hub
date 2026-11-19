/**
 * Optional Railway worker. Vercel cannot hold an open X filtered stream.
 * This process keeps that stream open and posts each matching tweet into the same Insider cron.
 *
 *   SITE_URL=https://autistik.io CRON_SECRET=... X_BEARER_TOKEN=... node worker/insider-stream.mjs
 *
 * Rules are rebuilt from the handles returned by the cron's tracked X accounts is not available here,
 * so set INSIDER_X_QUERY to the filtered-stream rule, for example: from:alice OR from:bob
 * Telegram and Reddit keep working on the Vercel minute cron without this process.
 */
const site = (process.env.SITE_URL || "https://autistik.io").replace(/\/+$/, "");
const key = process.env.CRON_SECRET || "";
const token = process.env.X_BEARER_TOKEN || "";
const query = process.env.INSIDER_X_QUERY || "";

async function rules() {
  if (!query) return;
  await fetch("https://api.x.com/2/tweets/search/stream/rules", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ add: [{ value: query.slice(0, 512), tag: "insider" }] }),
  });
}

async function push(tweet, user) {
  await fetch(`${site}/api/insider/cron`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-key": key },
    body: JSON.stringify({
      posts: [{ kind: "x", who: user || "x", text: tweet.text || "", url: `https://x.com/${user || "i"}/status/${tweet.id}`, at: Date.parse(tweet.created_at) || Date.now() }],
    }),
  });
}

async function stream() {
  await rules();
  const res = await fetch("https://api.x.com/2/tweets/search/stream?tweet.fields=created_at,author_id&expansions=author_id&user.fields=username", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const users = new Map((j.includes?.users || []).map((u) => [u.id, u.username]));
        if (j.data?.id) await push(j.data, users.get(j.data.author_id));
      } catch { /* heartbeat */ }
    }
  }
}

if (!token || !query) {
  console.log("Set X_BEARER_TOKEN and INSIDER_X_QUERY. The Vercel cron still searches recent posts without this worker.");
  process.exit(0);
}
for (;;) {
  try { await stream(); } catch (e) { console.error(e); }
  await new Promise((r) => setTimeout(r, 5000));
}
