import { createKeccak } from "hash-wasm";
import { concat, encodeAbiParameters, getAddress, keccak256, toHex, encodeFunctionData, parseAbi } from "viem";
import { randomBytes } from "crypto";
import fs from "fs";
const src = fs.readFileSync("lib/instant-token-code.ts", "utf8");
const code = "0x" + /v1: "0x([0-9a-f]+)"/.exec(src)[1];
const pad = "0xC2B048942Cb64d143d4a6C40Fca69fB84e1f9406", creator = "0x531A5ccB712B2bB997Ce0dF018707948c49Da5ba", name = "Test Coin", symbol = "TST";
const initHash = keccak256(concat([code, encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint256" }], [name, symbol, 10n ** 27n])]));
const hb = (h) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));
const k1 = await createKeccak(256), k2 = await createKeccak(256);
const inner = new Uint8Array(64); inner.set(hb(creator), 12); inner.set(randomBytes(32), 32);
const outer = new Uint8Array(85); outer[0] = 0xff; outer.set(hb(pad), 1); outer.set(hb(initHash), 53);
const t = Date.now(); let n = 0, found;
while (!found) { for (let j = 63; j > 55 && ++inner[j] === 256; j--) inner[j] = 0; n++;
  k1.init(); k1.update(inner); outer.set(k1.digest("binary"), 21); k2.init(); k2.update(outer); const h = k2.digest("binary");
  if (h[31] !== 0xaa || h[30] !== 0xaa) continue; const a = getAddress(toHex(h.subarray(12))); if (a.endsWith("AAAA")) found = { salt: toHex(inner.subarray(32)), a }; }
console.log(JSON.stringify({ ms: Date.now() - t, tries: n, ...found }));
console.log(encodeFunctionData({ abi: parseAbi(["function tokenFor(address,bytes32,string,string) view returns (address)"]), args: [creator, found.salt, name, symbol] }));
