"use client";
import { useState } from "react";

/** The contract address with a Copy button. */
export default function CopyAddress({ address }: { address: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="lp-ca" onClick={() => navigator.clipboard?.writeText(address).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}>
      <span className="mono">{address}</span><b>{done ? "Copied" : "Copy"}</b>
    </button>
  );
}
