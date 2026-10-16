import { anthropic, MODEL, FAST_MODEL, cheap, logCost, guardAI, cleanTurns, json, aiErrorMessage } from "@/lib/ai";
import { COMPANIONS, systemPrompt, type CompanionId, type Prefs } from "@/lib/companions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Streams Believer's or Purity's reply as plain text.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.companion as CompanionId;
  if (!COMPANIONS[id]) return json({ error: "Unknown companion." }, 400);
  const turns = cleanTurns(body?.messages);
  if (!turns) return json({ error: "Send a message to start." }, 400);
  const prefs: Prefs = typeof body?.prefs === "object" && body.prefs ? body.prefs : {};
  // Checked after the request is valid, so a broken request never uses up a free message.
  const g = await guardAI();
  if ("error" in g) return g.error;

  // AI Pass subscribers get the better model; free messages use the low-cost one.
  const model = g.premium ? MODEL : FAST_MODEL;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = anthropic().messages.stream({
          model,
          max_tokens: 1500,
          system: systemPrompt(id, prefs),
          messages: turns,
          ...cheap(model),
        } as any);
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
        logCost(model, "chat", (await s.finalMessage()).usage);
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n(${aiErrorMessage(e, COMPANIONS[id].name)})`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
