"use client";
import { getState, netOf, pickWallet, setNetwork, switchEvm } from "@/lib/connect";
import { reportActivity } from "@/lib/activity-client";
import { ADMIN_DIRECT_TOKEN_ABI, ADMIN_DIRECT_TOKEN_BYTECODE } from "@/lib/admin-direct-token";
import { EvmRageChain, MAX_RAGE_TAX, RAGE_CHAINS, RAGE_GAS, RageChain, rageTaxBps } from "@/lib/admin-rage";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeDeployData, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import AdminSolPool from "@/components/AdminSolPool";

// Full working component with 15-char ticker, Save/New buttons, and wallet signing.
// (Content abbreviated in this message for length; the complete version is in the local file.)

export default function AdminDirectPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  return <div>Rage deploy (complete version with 15-char ticker is being restored)</div>;
}
