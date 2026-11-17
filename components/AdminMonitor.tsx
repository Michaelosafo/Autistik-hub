"use client";

import { useMemo, useState } from "react";
import { createPublicClient, formatEther, formatUnits, getAddress, http, isAddress, parseAbi } from "viem";
import { CHAINS, viemChain } from "@/lib/launchpad";

const CHAIN = CHAINS.bsc;
const TOKEN_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
]);

type WalletRow = { address: string; bnb?: string; token?: string; error?: string };
const short = (v: string) => v ? `${v.slice(0, 7)}…${v.slice(-5)}` : "—";

export default function AdminMonitor() {
  const chain = useMemo(() => viemChain(CHAIN), []);
  const client = useMemo(() => createPublicClient({ chain, transport: http(CHAIN.rpc) }) as any, [chain]);
  const [addresses, setAddresses] = useState<string[]>(["", "", "", "", ""]);
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Add public wallet addresses and an optional token contract, then refresh balances.");

  function updateAddress(index: number, value: string) {
    setAddresses((old) => old.map((v, i) => i === index ? value : v));
  }

  async function refresh() {
    const valid = addresses.map((v) => v.trim()).filter(Boolean);
    if (!valid.length) { setMessage("Add at least one public wallet address."); return; }
    if (valid.length > 5 || valid.some((v) => !isAddress(v))) {
      setMessage("Check the wallet addresses. BNB Chain addresses must be valid 0x… addresses.");
      return;
    }
    const token = tokenAddress.trim();
    if (token && !isAddress(token)) { setMessage("The token contract address is not valid."); return; }
    setBusy(true);
    setMessage("Reading balances from BNB Chain…");
    try {
      let symbol = "";
      let decimals = 18;
      if (token) {
        const [s, d] = await Promise.all([
          client.readContract({ address: getAddress(token), abi: TOKEN_ABI, functionName: "symbol" }),
          client.readContract({ address: getAddress(token), abi: TOKEN_ABI, functionName: "decimals" })
        ]);
        symbol = String(s);
        decimals = Number(d);
      }
      const next = await Promise.all(valid.map(async (raw): Promise<WalletRow> => {
        const address = getAddress(raw);
        try {
          const bnb = await client.getBalance({ address });
          const tokenBalance = token
            ? await client.readContract({ address: getAddress(token), abi: TOKEN_ABI, functionName: "balanceOf", args: [address] })
            : null;
          return {
            address,
            bnb: Number(formatEther(bnb)).toLocaleString("en-US", { maximumFractionDigits: 6 }),
            ...(tokenBalance !== null ? { token: Number(formatUnits(tokenBalance as bigint, decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 }) } : {})
          };
        } catch {
          return { address, error: "Balance lookup failed" };
        }
      }));
      setTokenSymbol(symbol);
      setTokenDecimals(decimals);
      setRows(next);
      setMessage(`Updated ${next.length} wallet(s) on BNB Chain. Read-only mode: no transaction was sent.`);
    } catch (e: any) {
      setMessage(String(e?.shortMessage || e?.message || "Could not read BNB Chain data."));
    } finally {
      setBusy(false);
    }
  }

  const validCount = addresses.filter((v) => v.trim()).length;
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>Monitor · BNB Chain</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>Read-only wallet and token-balance monitor. Add up to five public addresses; no private keys are requested or stored.</p>
      </div>
      <div className="notice">
        <b>Security boundary</b><br />
        This phase does not import private keys, sign transactions, coordinate buys, or disguise related activity. Every wallet remains independently identifiable on-chain.
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <b>Wallet addresses ({validCount}/5)</b>
        {addresses.map((value, index) => (
          <label className="field" key={index}>
            <span>Wallet {index + 1} · public address</span>
            <input value={value} onChange={(e) => updateAddress(index, e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
          </label>
        ))}
      </div>
      <label className="field">
        <span>Token contract address (optional)</span>
        <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
      </label>
      <button className="btn primary" type="button" disabled={busy || validCount === 0} onClick={refresh}>
        {busy ? "Reading BNB Chain…" : "Refresh balances"}
      </button>
      <small className="muted">{message}</small>
      {rows.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <b>Wallet overview</b>
          {rows.map((row) => (
            <div className="notice stack" key={row.address} style={{ gap: 5 }}>
              <b className="mono">{short(row.address)}</b>
              {row.error ? <small className="muted">{row.error}</small> : (
                <>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <small className="muted">BNB balance</small><b>{row.bnb} BNB</b>
                  </div>
                  {row.token !== undefined && (
                    <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                      <small className="muted">{tokenSymbol || "Token"} balance</small><b>{row.token} {tokenSymbol}</b>
                    </div>
                  )}
                </>
              )}
              <a href={`${CHAIN.explorer}/address/${row.address}`} target="_blank" rel="noreferrer">View wallet on BscScan ↗</a>
            </div>
          ))}
          {tokenAddress.trim() && isAddress(tokenAddress.trim()) && (
            <small className="muted">Token: <a href={`${CHAIN.explorer}/token/${getAddress(tokenAddress.trim())}`} target="_blank" rel="noreferrer">{short(getAddress(tokenAddress.trim()))} on BscScan ↗</a></small>
          )}
        </div>
      )}
    </section>
  );
}
