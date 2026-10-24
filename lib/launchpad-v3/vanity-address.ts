/** V3 address-suffix acceptance checks. These validate addresses only; they do not generate vanity addresses. */

export const SOLANA_V3_MINT_SUFFIX = "tik";
export const EVM_V3_CONTRACT_SUFFIX = "aaa";

/** Solana base58 is case-sensitive; do not lowercase this address. */
export function isV3SolanaMintAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) &&
    address.endsWith(SOLANA_V3_MINT_SUFFIX);
}

/** EVM addresses are hexadecimal and suffix matching is case-insensitive. */
export function isV3EvmContractAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address) &&
    address.toLowerCase().endsWith(EVM_V3_CONTRACT_SUFFIX);
}

export function assertV3LaunchAddress(
  chain: "solana" | "evm",
  address: string,
): void {
  const valid = chain === "solana"
    ? isV3SolanaMintAddress(address)
    : isV3EvmContractAddress(address);

  if (!valid) {
    throw new Error(
      chain === "solana"
        ? 'V3 Solana launch rejected: mint address must end with "tik".'
        : 'V3 EVM launch rejected: contract address must end with "AAA".',
    );
  }
}
