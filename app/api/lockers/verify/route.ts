import { adminState } from "@/lib/admin";
import { supabaseService } from "@/lib/supabase/server";
import { isLockerChain, LOCKER_CHAINS } from "@/lib/locker";
import { LOCKER_COMPILER } from "@/lib/locker-build";
import { lockerOn, lockerSites } from "@/lib/locker-server";
import input from "@/contracts/AutistikLocker.input.json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, status = 200) => Response.json(body, { status });
const API = "https://api.etherscan.io/v2/api";

/**
 * Admin only: publishes the locker's source on the chain's explorer (BscScan, Etherscan, BaseScan…) so anyone can read
 * the code. Needs ETHERSCAN_API_KEY in Vercel (one free key from etherscan.io works for all these explorers).
 */
export async function POST(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const { chain } = await req.json().catch(() => ({}));
  if (!isLockerChain(chain)) return json({ error: "Unknown chain." }, 400);
  const site = await lockerOn(chain);
  if (!site) return json({ error: "The locker isn't on that chain yet." }, 404);
  const key = (process.env.ETHERSCAN_API_KEY || "").trim();
  const name = LOCKER_CHAINS[chain].name;
  if (!key) return json({ message: `Automatic verify needs an Etherscan API key in Vercel (ETHERSCAN_API_KEY). Or verify by hand with the file linked below.` });

  const chainid = String(LOCKER_CHAINS[chain].viem.id);
  const body = new URLSearchParams({
    module: "contract", action: "verifysourcecode", apikey: key, chainid, contractaddress: site.address,
    sourceCode: JSON.stringify(input), codeformat: "solidity-standard-json-input", contractname: "AutistikLocker.sol:AutistikLocker",
    compilerversion: LOCKER_COMPILER, constructorArguements: "",
  });
  const done = async () => { await supabaseService().from("locker_contracts").update({ verified: true }).eq("chain", chain); await lockerSites(true); };
  try {
    const sub = await fetch(`${API}?chainid=${chainid}`, { method: "POST", body, signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
    if (sub?.status !== "1") {
      const why = String(sub?.result || sub?.message || "");
      if (/already verified/i.test(why)) { await done(); return json({ message: `✓ Already verified on the ${name} explorer.` }); }
      return json({ message: `The ${name} explorer said: ${why.slice(0, 200)}. You can verify by hand with the file linked below.` });
    }
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await fetch(`${API}?chainid=${chainid}&module=contract&action=checkverifystatus&guid=${encodeURIComponent(sub.result)}&apikey=${key}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
      const res = String(st?.result || "");
      if (/pass|already verified/i.test(res)) { await done(); return json({ message: `✓ Verified! Anyone can now read the locker's code on the ${name} explorer.` }); }
      if (!/pending|queue/i.test(res)) return json({ message: `The ${name} explorer said: ${res.slice(0, 200)}` });
    }
    return json({ message: "Still checking on the explorer's side. Press Verify again in a minute." });
  } catch {
    return json({ message: `Couldn't reach the ${name} explorer. Try again in a minute.` });
  }
}
