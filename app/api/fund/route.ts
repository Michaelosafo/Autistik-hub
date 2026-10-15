import { json } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";
import { humanCheck, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

// Saves a "register your interest" entry for the AUTISTIK Fund.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "fund", 5, 3600);
  if (slow) return slow;
  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Something went wrong. Try again." }, 400);
  if (body.website) return json({ ok: true }); // hidden field only bots fill in
  const name = clip(body.name, 100);
  const email = clip(body.email, 200).toLowerCase();
  const country = clip(body.country, 80);
  const phone = clip(body.phone, 40);
  const message = clip(body.message, 1000);
  if (!name) return json({ error: "Please enter a name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!country) return json({ error: "Please enter the country you live in." }, 400);
  if (body.consent !== true) return json({ error: "Please tick the box so we can contact you." }, 400);
  const bot = await humanCheck(body.captcha, req);
  if (bot) return bot;

  // An email that's already registered is kept as it is, so nobody can change someone else's details by
  // typing their email. The answer is the same either way, so the form doesn't reveal who has registered.
  const { error } = await supabaseService().from("fund_interest").upsert(
    { name, email, country, phone: phone || null, message: message || null, for_someone_else: body.forSomeoneElse === true },
    { onConflict: "email", ignoreDuplicates: true },
  );
  if (error) return json({ error: "Couldn't save your details right now. Try again later." }, 500);
  return json({ ok: true });
}
