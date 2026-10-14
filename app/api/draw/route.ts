import { anthropic, MODEL, guardAI, json } from "@/lib/ai";
import { COMPANIONS, drawPrompt, type CompanionId } from "@/lib/companions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Asks the companion to draw an original SVG illustration.
export async function POST(req: Request) {
  const g = await guardAI();
  if ("error" in g) return g.error;

  const body = await req.json().catch(() => null);
  const id = body?.companion as CompanionId;
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  if (!COMPANIONS[id] || request.length < 3) return json({ error: "Describe the picture you want." }, 400);

  try {
    const msg = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: drawPrompt(id, request) }],
    });
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    if (/^NO:/i.test(text)) return json({ refusal: text.replace(/^NO:\s*/i, "") });
    const m = text.match(/<svg[\s\S]*<\/svg>/i);
    if (!m) return json({ error: "That picture didn't come out right. Try describing it a little differently." }, 422);
    // First-pass strip on the server; the browser cleans it fully before showing it.
    const svg = m[0].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return json({ svg });
  } catch {
    return json({ error: "Something went wrong while drawing. Try again." }, 502);
  }
}
