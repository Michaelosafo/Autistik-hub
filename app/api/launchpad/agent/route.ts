import Anthropic from "@anthropic-ai/sdk";
import { anthropic, FAST_MODEL, cheap, logCost, guardAI, cleanTurns, json, aiErrorMessage } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";
import { AI_LAUNCH_SESSIONS, CHAINS, LOCKS, MAX_CREATOR_PERCENT, MIN_HOLD_USD, checkPlan, liveChains, type Pads } from "@/lib/launchpad";
import { padSites } from "@/lib/launchpad-server";
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
      creatorPercent: { type: "number", description: "Share of supply sent to the creator's wallet, 0-20" },
      liquidity: { type: "string", description: "Amount of the chain's coin (BNB or ETH) to add to the pool, e.g. 0.5" },
      lock: { type: "string", enum: ["6m", "1y", "burn"], description: "What happens to the LP tokens: 6m = locked 6 months, 1y = locked 1 year, burn = sent to the dead address forever" },
      description: { type: "string", description: "Short description, or empty string" },
      website: { type: "string", description: "https link, or empty string" },
      x: { type: "string", description: "https link to the X profile, or empty string" },
      telegram: { type: "string", description: "https link to the Telegram group, or empty string" },
    },
  },
};

function systemPrompt(pads: Pads) {
  const live = liveChains(pads);
  const chainLines = Object.values(CHAINS)
    .map((c) => `- ${c.name} (${c.key}): pairs with ${c.coin} on ${c.dex}. ${live.includes(c) ? "OPEN for launches." : "NOT open yet - tell the creator it's coming soon and offer an open chain."}`)
    .join("\n");
  return `You are Autistik, the launch agent of AUTISTIK Launch Pad, part of AUTISTIK Hub, a community for autistic adults.
You help people launch their own token. You speak like a calm, professional launch advisor: polished, clear and literal, in complete sentences with correct grammar. Short messages. Ask one question at a time. No slang, filler, chatty openers, idioms or hype.
Your replies may be read out loud by the site's voice, so write the way you would speak: no markdown, no bullet symbols, no tables, no emoji. Say numbers plainly.

How a launch works (explain when useful, don't lecture):
- The creator answers your questions, you show them a launch plan, and they press Launch and sign ONE transaction in their own wallet. You never hold their money and you can't sign for them.
- The AUTISTIK Launch Pad smart contract creates a token with a fixed supply: no minting and no blacklist. Plans made with you have no tax and no whitelist. If the creator wants a tax (up to 10%), a whitelist of up to 3 wallets or a first buy, tell them to use the Quick launch form instead, which has those options.
- Trading starts when the creator presses Start trading on their token page after launch, and opens by itself after 24 hours at the latest. For the first 5 minutes, each buy is limited to stop sniper bots.
- The creator can keep 0-20% of the supply. All the rest goes into the liquidity pool with the coin they add.
- The creator chooses what happens to the pool's LP tokens. There are three options:
  1. ${LOCKS["6m"].label}: ${LOCKS["6m"].explain}
  2. ${LOCKS["1y"].label}: ${LOCKS["1y"].explain}
  3. ${LOCKS.burn.label}: ${LOCKS.burn.explain}
  Longer locks and burning usually make buyers trust a token more. With burn, make sure the creator understands they will never get that coin back.
- To launch, the wallet they launch from must hold at least $${MIN_HOLD_USD} worth of AUTISTIK on BNB Chain, and keep it there until the launch is done. The Hub checks this automatically when they press Launch. If they don't hold enough, they can buy AUTISTIK on PancakeSwap into the same wallet first. AUTISTIK is not spent or taken; it just has to be in the wallet.
- Trading opens straight away on the DEX. DexScreener shows the pair automatically once it has liquidity and trades. Afterwards they can add a logo and links on DexScreener themselves.
- Launching is free. A small contribution of about $3 is taken from the liquidity amount and supports AUTISTIK. Every buy and sell of the token also pays a small 0.3% platform fee that supports AUTISTIK and buys and burns $AUTISTIK.
- After launch, the token gets its own page on the Launch Pad with a chart and a Watch button. Anyone can pay to make it trend: $${TRENDING_USD} worth of BNB, paid on BNB Chain to the AUTISTIK wallet shown in the "Get your token listed & trending" box, for ${TRENDING_HOURS} hours. Paying again adds time. Tokens launched somewhere else can be listed the same way, as long as they have a trading pool on DexScreener. Trending tokens show at the top of the board and in the "Ad" slot across the Hub, labelled as paid. Don't pressure anyone to buy it.

Chains:
${chainLines}

Collect, in this order:
1. Chain
2. Token name
3. Ticker
4. Total supply (whole tokens; suggest 1,000,000,000 if they don't mind)
5. How much of the supply they want to keep (0-20%; less looks fairer to buyers)
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
  const session = String(body?.session || "");
  const pads = await padSites();
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(session)) return json({ error: "Please refresh the page and try again." }, 400);

  // 2 AI launch sessions a day (30 messages each). The quick launch form is unlimited and uses no AI.
  const { data: t, error: tErr } = await supabaseService().rpc("launch_ai_turn", { p_user: g.uid, p_session: session, p_max: AI_LAUNCH_SESSIONS, p_max_messages: 30 });
  if (tErr) console.error("launch_ai_turn failed (has supabase/ai-budget.sql been run?):", tErr.message);
  const turn = (t || { ok: true, sessions_left: null }) as { ok: boolean; reason?: string; sessions_left: number | null };
  if (!turn.ok) {
    return json({
      limit: true, sessionsLeft: turn.sessions_left ?? 0,
      error: turn.reason === "messages"
        ? "This assistant session has reached its 30-message limit. Use the Quick launch form, or press Start over to begin a new assistant session."
        : `You've used today's ${AI_LAUNCH_SESSIONS} AI launch sessions. The Quick launch form has no limit, or come back tomorrow.`,
    }, 429);
  }

  try {
    const msg = await anthropic().messages.create({
      model: FAST_MODEL,
      max_tokens: 4000,
      system: systemPrompt(pads),
      tools: [PREPARE_LAUNCH],
      messages: turns,
      ...cheap(FAST_MODEL),
    } as any);
    logCost(FAST_MODEL, "launch", msg.usage);
    if ((msg.stop_reason as string) === "refusal") return json({ reply: "I can't help with that one. Let's try a different idea for your token." });

    const reply = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "prepare_launch");
    const left = turn.sessions_left;
    if (!call) return json({ reply: reply || "I'm sorry, I didn't catch that. Could you say it again?", sessionsLeft: left });

    const checked = checkPlan({ ...(call.input as any), buyTax: 0, sellTax: 0, taxWallet: "", whitelist: [], devBuy: "0", creatorPercent: Math.min(20, Number((call.input as any)?.creatorPercent) || 0) }, pads);
    if ("error" in checked) return json({ reply: `${reply ? reply + "\n\n" : ""}One thing needs fixing first: ${checked.error}`, sessionsLeft: left });
    return json({ reply: reply || "Here is your launch plan. Please check it carefully.", plan: checked.plan, sessionsLeft: left });
  } catch (e) {
    return json({ error: aiErrorMessage(e, "Autistik") }, 502);
  }
}
