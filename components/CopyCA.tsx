"use client";
import { useState } from "react";

/** Shows the official contract address with a Copy button. */
export default function CopyCA({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <div className="row" style={{ gap: 8 }}>
      <code className="mono" style={{ overflowWrap: "anywhere", minWidth: 0, flex: "1 1 260px" }}>{address}</code>
      <button className="btn small" type="button" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
    </div>
  );
}
