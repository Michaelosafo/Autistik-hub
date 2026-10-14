import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, guardAI, cleanTurns, json } from "@/lib/ai";
import { CHAINS, MAX_CREATOR_PERCENT, checkPlan, liveChains } from "@/lib/launchpad";

export const runtime = "nodejs";
export const maxDuration = 60;

const PREPARE_LAUNCH: Anthropic.Tool = {
  name: "prepare_launch",
  description:
    "Show the creator their finished launch plan so they can review it and sign the launch with their own wallet. Call this only after the creator has given every answer and confirmed the summary.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["chain", "name", "symbol", "supply", "creatorPercent", "liquidity", "description", "website", "x", "telegram"],
    properties: {
      chain: { type: "string", enum: ["bsc", "ethereum", "robinhood"], description: "bsc = BNB Chain (PancakeSwap), ethereum = Ethereum (Uniswap), robinhood = Robinhood Chain" },
      name: { type: "string", description: "Token name, 1-32 characters" },
      symbol: { type: "string", description: "Ticker, 1-12 letters or numbers, no $" },
      supply: { type: "string", description: "Total supply in whole tokens, digits only, e.g. 1000000000" },
      creatorPercent: { type: "number", description: `Share of supply sent to the creator's wallet, 0-${MAX_CREATOR_PERCENT}` },
      liquidity: { type: "string", description: "Amount of the chain's coin (BNB or ETH) to add to the pool, e.g. 0.5" },
      description: { type: "string", description: "Short description, or empty string" },
      website: { type: "string", description: "https link, or empty string" },
      x: { type: "string", description: "https link to the X profile, or empty string" },
      telegram: { type: "string", description: "https link to the Telegram group, or empty string" },
    },
  },
};

function systemPrompt() {
  const live = liveChains();
  const chainLines = Object.values(CHAINS)
    .map((c) => `- ${c.name} (${c.key}): pairs with ${c.coin} on ${c.dex}. ${live.includes(c) ? "OPEN for launches." : "NOT open yet - tell the creator it's coming soon and offer an open chain."}`)
    .join("\n");
  return `You are Autistik, the launch agent of AUTISTIK Launch Pad, part of AUTISTIK Hub, a community for autistic adults.
You help people launch their own token. You talk in plain, literal, friendly language. Short messages. Ask one or two questions at a time. No idioms or hype.

How a launch works (explain when useful, don't lecture):
- The creator answers your questions, you show them a launch plan, and they press Launch and sign ONE transaction in their own wallet. You never hold their money and you can't sign for them.
- The AutistikLaunchpad smart contract creates a simple token with a fixed supply: no tax, no minting, no owner, no blacklist.
- The creator can keep 0-${MAX_CREATOR_PERCENT}% of the supply. All the rest goes into the liquidity pool with the coin they add.
- The pool's LP tokens are sent to the dead address, so the liquidity is locked forever. Nobody can remove it: not the creator, not Autistik, not the AUTISTIK team. Make sure the creator understands they will not get that coin back.
- Trading opens straight away on the DEX. DexScreener shows the pair automatically once it has liquidity and trades. Afterwards they can add a logo and links on DexScreener themselves.
- A small launch fee may apply. The exact fee shows on the Launch button before they sign.
- After launch, the token gets its own page on the Launch Pad with a chart and a Watch button. Anyone can pay to make it trend: $30 for 5 hours or $200 for 24 hours, paid in USDT. Trending tokens show at the top of the board and in the "Ad" slot across the Launch Pad, labelled as paid. Don't pressure anyone to buy it.

Chains:
${chainLines}

Collect, in this order:
1. Chain
2. Token name
3. Ticker
4. Total supply (whole tokens; suggest 1,000,000,000 if they don't mind)
5. How much of the supply they want to keep (0-${MAX_CREATOR_PERCENT}%; less looks fairer to buyers)
6. How much BNB or ETH to put in the pool (suggest around 0.5; more liquidity means steadier prices)
7. Optional: a one-line description, website, X and Telegram links (https links only)

Then show a short summary and ask them to confirm. Only when they confirm, call prepare_launch. After that, tell them to check the plan card, tick the box and press Launch. If they want to change something, ask, then call prepare_launch again with the new plan.

Rules:
- Never ask for, or accept, a seed phrase or private key. If someone shares one, tell them to move their funds to a new wallet right away.
- Don't promise or predict prices, profits or "going to the moon". Nothing here is financial advice. Tokens can lose all their value.
- Don't help create a token that pretends to be an existing coin, company, brand or real person, or that is meant to trick buyers. Kindly explain and suggest an original name.
- If someone seems upset or in crisis, be kind and point them to findahelpline.com.`;
}

// Autistik asks questions and, once the creator confirms, returns a launch plan for them to sign.
export async function POST(req: Request) {
  const g = await guardAI("Autistik");
  if ("error" in g) return g.error;

  const body = await req.json().catch(() => null);
  const turns = cleanTurns(body?.messages);
  if (!turns) return json({ error: "Send a message to start." }, 400);

  try {
    const msg = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(),
      tools: [PREPARE_LAUNCH],
      messages: turns,
    });
    if ((msg.stop_reason as string) === "refusal") return json({ reply: "I can't help with that one. Let's try a different idea for your token." });

    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "prepare_launch");
    if (!call) return json({ reply: reply || "Sorry, I lost my train of thought. Could you say that again?" });

    const checked = checkPlan(call.input as any);
    if ("error" in checked) return json({ reply: `${reply ? reply + "\n\n" : ""}One thing needs fixing first: ${checked.error}` });
    return json({ reply: reply || "Here's your launch plan. Check it carefully below.", plan: checked.plan });
  } catch {
    return json({ error: "Autistik couldn't answer right now. Try again in a moment." }, 502);
  }
}
