import { anthropic, MODEL, guardAI, cleanTurns, json } from "@/lib/ai";
import { COMPANIONS, systemPrompt, type CompanionId, type Prefs } from "@/lib/companions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Streams Believer's or Purity's reply as plain text.
export async function POST(req: Request) {
  const g = await guardAI();
  if ("error" in g) return g.error;

  const body = await req.json().catch(() => null);
  const id = body?.companion as CompanionId;
  if (!COMPANIONS[id]) return json({ error: "Unknown companion." }, 400);
  const turns = cleanTurns(body?.messages);
  if (!turns) return json({ error: "Send a message to start." }, 400);
  const prefs: Prefs = typeof body?.prefs === "object" && body.prefs ? body.prefs : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const s = anthropic().messages.stream({
          model: MODEL,
          max_tokens: 800,
          system: systemPrompt(id, prefs),
          messages: turns,
        });
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch (e) {
        controller.enqueue(encoder.encode("\n\n(Sorry, something went wrong. Please try again.)"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
