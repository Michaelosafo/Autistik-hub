import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, guardAI, cleanTurns, json, aiErrorMessage } from "@/lib/ai";
import { CHAINS, LOCKS, MAX_CREATOR_PERCENT, MIN_HOLD_USD, checkPlan, liveChains } from "@/lib/launchpad";
import { TRENDING_HOURS, TRENDING_USD } from "@/lib/trending";

export const runtime = "nodejs";
export const maxDuration = 60;

const PREPARE_LAUNCH: Anthropic.Tool = {
  name: "prepare_launch",
  description:
    "Show the creator their finished launch plan so they can review it and sign the launch with their own wallet. Call this only after the creator has given every answer and confirmed the summary.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["chain", "name", "symbol", "supply", "creatorPercent", "liquidity", "lock", "description", "website", "x", "telegram"],
    properties: {
      chain: { type: "string", enum: ["bsc", "ethereum", "robinhood"], description: "bsc = BNB Chain (PancakeSwap), ethereum = Ethereum (Uniswap), robinhood = Robinhood Chain" },
      name: { type: "string", description: "Token name, 1-32 characters" },
      symbol: { type: "string", description: "Ticker, 1-12 letters or numbers, no $" },
      supply: { type: "string", description: "Total supply in whole tokens, digits only, e.g. 1000000000" },
      creatorPercent: { type: "number", description: `Share of supply sent to the creator's wallet, 0-${MAX_CREATOR_PERCENT}` },
      liquidity: { type: "string", description: "Amount of the chain's coin (BNB or ETH) to add to the pool, e.g. 0.5" },
      lock: { type: "string", enum: ["6m", "1y", "burn"], description: "What happens to the LP tokens: 6m = locked 6 months, 1y = locked 1 year, burn = sent to the dead address forever" },
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
You help people launch their own token. You talk in plain, literal, friendly language. Short messages. Ask one question at a time. No idioms or hype.
Your replies may be read out loud by the site's voice, so write the way you would speak: no markdown, no bullet symbols, no tables, no emoji. Say numbers plainly.

How a launch works (explain when useful, don't lecture):
- The creator answers your questions, you show them a launch plan, and they press Launch and sign ONE transaction in their own wallet. You never hold their money and you can't sign for them.
- The AutistikLaunchpad smart contract creates a simple token with a fixed supply: no tax, no minting, no owner, no blacklist.
- The creator can keep 0-${MAX_CREATOR_PERCENT}% of the supply. All the rest goes into the liquidity pool with the coin they add.
- The creator chooses what happens to the pool's LP tokens. There are three options:
  1. ${LOCKS["6m"].label}: ${LOCKS["6m"].explain}
  2. ${LOCKS["1y"].label}: ${LOCKS["1y"].explain}
  3. ${LOCKS.burn.label}: ${LOCKS.burn.explain}
  Longer locks and burning usually make buyers trust a token more. With burn, make sure the creator understands they will never get that coin back.
- To launch, the wallet they launch from must hold at least $${MIN_HOLD_USD} worth of AUTISTIK on BNB Chain, and keep it there until the launch is done. The Hub checks this automatically when they press Launch. If they don't hold enough, they can buy AUTISTIK on PancakeSwap into the same wallet first. AUTISTIK is not spent or taken; it just has to be in the wallet.
- Trading opens straight away on the DEX. DexScreener shows the pair automatically once it has liquidity and trades. Afterwards they can add a logo and links on DexScreener themselves.
- A small launch fee is paid in the same transaction and goes to the AUTISTIK deployer wallet. The exact fee shows on the Launch button before they sign.
- After launch, the token gets its own page on the Launch Pad with a chart and a Watch button. Anyone can pay to make it trend: $${TRENDING_USD} worth of BNB, paid on BNB Chain to the AUTISTIK wallet shown in the "Get your token listed & trending" box, for ${TRENDING_HOURS} hours. Paying again adds time. Tokens launched somewhere else can be listed the same way, as long as they have a trading pool on DexScreener. Trending tokens show at the top of the board and in the "Ad" slot across the Hub, labelled as paid. Don't pressure anyone to buy it.

Chains:
${chainLines}

Collect, in this order:
1. Chain
2. Token name
3. Ticker
4. Total supply (whole tokens; suggest 1,000,000,000 if they don't mind)
5. How much of the supply they want to keep (0-${MAX_CREATOR_PERCENT}%; less looks fairer to buyers)
6. How much BNB or ETH to put in the pool (suggest around 0.5; more liquidity means steadier prices)
7. What to do with the liquidity: lock 6 months, lock 1 year, or burn
8. Optional: a one-line description, website, X and Telegram links (https links only)

Then show a short summary and ask them to confirm. Only when they confirm, call prepare_launch. After that, tell them to check the plan card, tick the box and press Launch. If they want to change something, ask, then call prepare_launch again with the new plan.

Rules:
- Never ask for, or accept, a seed phrase or private key. If someone shares one, tell them to move their funds to a new wallet right away.
- Don't promise or predict prices, profits or "going to the moon". Nothing here is financial advice. Tokens can lose all their value.
- Don't help create a token that pretends to be an existing coin, company, brand or real person, or that is meant to trick buyers. Kindly explain and suggest an original name.
- If someone seems upset or in crisis, be kind and point them to findahelpline.com.`;
}

// Autistik asks questions and, once the creator confirms, returns a launch plan for them to sign.
export async function POST(req: Request) {
  const g = await guardAI("Autistik", { needsPass: false }); // the launch guide stays free: launches pay their own fee
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
  } catch (e) {
    return json({ error: aiErrorMessage(e, "Autistik") }, 502);
  }
}
