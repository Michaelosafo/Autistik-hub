#!/usr/bin/env node
// Builds an airdrop round from a CSV of wallet,amount.
//
//   npm run merkle -- airdrops/round-1.csv 1
//   npm run merkle -- airdrops/round-1.csv 1 --decimals 18
//
// CSV: one row per wallet, amount in WHOLE tokens (e.g. 1500 or 12.5). A header row is fine.
// Output:
//   - prints the Merkle root → call setRoot(round, root) on the AutistikAirdrop contract
//   - writes public/airdrops/current.json → the Rewards page reads it to show "Claim now"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, parseUnits } from "viem";

const args = process.argv.slice(2);
const file = args[0];
const round = Number(args[1]);
const di = args.indexOf("--decimals");
const decimals = di >= 0 ? Number(args[di + 1]) : 18;
if (!file || !Number.isInteger(round) || round < 1) {
  console.error("Usage: npm run merkle -- <file.csv> <round number> [--decimals 18]");
  process.exit(1);
}

const totals = new Map();
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || /^wallet/i.test(line) || line.startsWith("#")) continue;
  const [w, amt] = line.split(",").map((s) => s.trim());
  let addr;
  try { addr = getAddress(w); } catch { console.warn("Skipping bad address:", w); continue; }
  if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) { console.warn("Skipping bad amount for", addr, amt); continue; }
  const units = parseUnits(amt, decimals);
  totals.set(addr, (totals.get(addr) || 0n) + units);
}
if (!totals.size) { console.error("No valid rows found."); process.exit(1); }

const values = [...totals.entries()].map(([a, v]) => [a, v.toString()]);
const tree = StandardMerkleTree.of(values, ["address", "uint256"]);
const claims = {};
let sum = 0n;
for (const [i, [a, v]] of tree.entries()) {
  claims[a.toLowerCase()] = { amount: v, display: Number(BigInt(v) / 10n ** BigInt(Math.max(0, decimals - 2))) / 100 + "", proof: tree.getProof(i) };
  sum += BigInt(v);
}
mkdirSync("public/airdrops", { recursive: true });
writeFileSync("public/airdrops/current.json", JSON.stringify({ round, root: tree.root, claims }, null, 2));
writeFileSync(`airdrops/round-${round}.tree.private.json`, JSON.stringify(tree.dump()), { flag: "w" });

console.log(`\nRound ${round}: ${totals.size} wallets, total ${Number(sum / 10n ** BigInt(decimals)).toLocaleString()} tokens`);
console.log(`Merkle root: ${tree.root}`);
console.log(`\nNext:\n 1. Send at least that many $AUTISTIK to the airdrop contract.\n 2. Call setRoot(${round}, ${tree.root}) from the owner wallet.\n 3. Commit public/airdrops/current.json and redeploy. Members can now claim on /rewards.\n`);
