import { getAddress, isAddress } from "viem";
import { adminState } from "@/lib/admin";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { ORDERS_ABI } from "@/lib/orders-build";
import { cancelOrder, createOrder, keeperAccount, listOrders, orderContracts, runKeeper } from "@/lib/orders-server";
import { KYBER_ROUTER, WCHAINS, isWChain } from "@/lib/wallet-chains";
import { walletChainClient } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TREASURY = process.env.NEXT_PUBLIC_TREASURY_WALLET || "0x531A5ccB712B2bB997Ce0dF018707948c49Da5ba";

/**
 * Limit and stop-loss orders. GET /api/orders/cron is the keeper (every minute, from the database scheduler; it runs at
 * most once every 50 seconds however often it's called). Everything else is POST.
 */
export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (params.action === "cron") {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
    const { data: go } = await supabaseService().rpc("trade_orders_lease", { p_seconds: 50 });
    if (go !== true) return json({ skipped: true });
    return json(await runKeeper(Date.now() + 45_000).catch((e) => ({ error: (e as Error).message })));
  }
  if (params.action === "config") {
    const contracts = await orderContracts();
    return json({ contracts, feeBps: 50 });
  }
  if (params.action === "admin") {
    if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
    const k = keeperAccount();
    return json({ keeper: k?.address ?? null, treasury: TREASURY, contracts: await orderContracts() });
  }
  return json({ error: "Not found." }, 404);
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const b = await req.json().catch(() => ({}));
  switch (params.action) {
    case "create": {
      const limited = await rateLimit(req, "orders-create", 20, 600);
      if (limited) return limited;
      const r = await createOrder(b);
      return "error" in r ? json(r, 400) : json(r);
    }
    case "list": {
      const limited = await rateLimit(req, "orders-list", 60, 60);
      if (limited) return limited;
      if (!isWChain(b.chain) || !isAddress(b.maker)) return json({ orders: [] });
      return json({ orders: await listOrders(b.chain, b.maker) });
    }
    case "cancel": {
      const limited = await rateLimit(req, "orders-cancel", 20, 600);
      if (limited) return limited;
      if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/.test(b.id) || typeof b.signature !== "string") return json({ error: "Bad request." }, 400);
      const r = await cancelOrder(b.id, b.signature as `0x${string}`);
      return "error" in r ? json(r, 400) : json(r);
    }
    case "contracts": {
      // Admin: save an Orders contract the admin just deployed, after checking it on-chain.
      if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
      if (!isWChain(b.chain) || WCHAINS[b.chain as keyof typeof WCHAINS].kind !== "evm" || !isAddress(b.address)) return json({ error: "Bad request." }, 400);
      const c = WCHAINS[b.chain as keyof typeof WCHAINS];
      const at = getAddress(b.address);
      const pc = walletChainClient(c);
      const keeper = keeperAccount();
      try {
        const [fee, treasury, wrapped, isKeeper, kyber] = await Promise.all([
          pc.readContract({ address: at, abi: ORDERS_ABI, functionName: "feeBps" }),
          pc.readContract({ address: at, abi: ORDERS_ABI, functionName: "treasury" }),
          pc.readContract({ address: at, abi: ORDERS_ABI, functionName: "wrapped" }),
          keeper ? pc.readContract({ address: at, abi: ORDERS_ABI, functionName: "keepers", args: [keeper.address] }) : Promise.resolve(false),
          pc.readContract({ address: at, abi: ORDERS_ABI, functionName: "routers", args: [KYBER_ROUTER] }),
        ]);
        if (Number(fee) !== 50 || getAddress(treasury) !== getAddress(TREASURY) || getAddress(wrapped) !== getAddress(c.wrapped!) || !kyber) return json({ error: "That contract isn't set up like the AUTISTIK Orders contract." }, 400);
        if (!isKeeper) return json({ error: "The keeper in Vercel (ORDERS_KEEPER_KEY) isn't a keeper on that contract." }, 400);
      } catch { return json({ error: `No AUTISTIK Orders contract at ${at} on ${c.name} yet. Wait a few seconds and try again.` }, 400); }
      await supabaseService().from("order_contracts").upsert({ chain: c.key, address: at, deployed_at: new Date().toISOString() });
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}
