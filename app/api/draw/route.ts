import { anthropic, MODEL, FAST_MODEL, cheap, logCost, guardAI, json, aiErrorMessage } from "@/lib/ai";
import { COMPANIONS, drawPrompt, type CompanionId } from "@/lib/companions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Asks the companion to draw an original SVG illustration.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.companion as CompanionId;
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  if (!COMPANIONS[id] || request.length < 3) return json({ error: "Describe the picture you want." }, 400);
  // Checked after the request is valid, so a broken request never uses up a free message.
  const g = await guardAI("Believer and Purity", { cost: 5 }); // a picture is about 5 messages of AI work
  if ("error" in g) return g.error;

  try {
    const model = g.premium ? MODEL : FAST_MODEL;
    const msg = await anthropic().messages.create({
      model,
      max_tokens: 8000,
      messages: [{ role: "user", content: drawPrompt(id, request) }],
      ...cheap(model),
    } as any);
    logCost(model, "draw", msg.usage);
    const text = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
    if (/^NO:/i.test(text)) return json({ refusal: text.replace(/^NO:\s*/i, "") });
    const m = text.match(/<svg[\s\S]*<\/svg>/i);
    if (!m) return json({ error: "That picture didn't come out right. Try describing it a little differently." }, 422);
    // First-pass strip on the server; the browser cleans it fully before showing it.
    const svg = m[0].replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");
    return json({ svg });
  } catch (e) {
    return json({ error: aiErrorMessage(e, COMPANIONS[id].name) }, 502);
  }
}
