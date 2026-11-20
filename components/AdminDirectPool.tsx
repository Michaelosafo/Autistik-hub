"use client";
import { useState } from "react";
import AdminSolPool from "@/components/AdminSolPool";

export default function AdminDirectPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  const [chainKey, setChainKey] = useState("bsc");
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <p className="muted">EVM Rage UI is being restored. Use Solana for now, or paste a CA after the full file is pushed.</p>
      {chainKey === "solana" ? <AdminSolPool mode={mode} /> : <div className="muted">Select a network and paste a token address once the full panel is live.</div>}
    </div>
  );
}
