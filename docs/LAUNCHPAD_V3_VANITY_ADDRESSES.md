# Launchpad V3 — Vanity Address Requirements

## Product requirement
- Solana token mint addresses must end with the exact lowercase suffix `tik`.
- EVM token contract addresses must end with the exact case-insensitive hexadecimal suffix `AAA` (i.e. `aaa` in a normalized address string).
- This is an address-generation requirement, not a token-symbol or metadata change.
- Keep the current launchpad and production deployment unchanged while V3 is developed on `v3-vanity-addresses`.

## Implementation design

### Solana
1. Generate candidate mint keypairs with a bounded, cancellable vanity-search worker.
2. Compare the base58-encoded public key suffix to `tik`.
3. Create the mint using the matching keypair and sign the mint-account creation transaction.
4. Keep the matching secret key only in the intended signer context; never log it, persist it in application storage, or send it to analytics.
5. Verify the resulting on-chain mint address ends in `tik` before the launch is marked successful.

The suffix is case-sensitive because Solana addresses use base58. Search can take a variable amount of time, so the UI must show progress and allow cancellation. Never silently fall back to a non-matching address.

### EVM
1. Use deterministic deployment (normally CREATE2) with the exact final init-code hash and a factory that is already deployed at a known address.
2. Search salts until the predicted contract address ends in `aaa` after lowercase normalization.
3. Verify the predicted address using the same bytecode, constructor arguments, factory and salt that will be used for deployment.
4. Deploy, then compare the actual deployed address to the prediction and enforce the suffix before marking the launch successful.

A contract's address depends on the chain, deployer/factory, salt and init code. A generic frontend loop cannot guarantee this requirement without the actual deployment factory/bytecode. Each supported EVM chain needs a verified factory deployment and tests.

## Launch safety gates
- Never mark a launch successful until the address suffix is verified on-chain.
- If generation/deployment fails, report failure; do not silently launch at a normal address.
- Do not change the current production deployment or deploy contracts as part of this branch.
- Testnet/local tests must cover suffix matching, cancellation, invalid addresses, and deployment mismatch.
- Production launch must remain disabled until the Solana mint flow and per-chain EVM CREATE2 factory are implemented, audited, and tested.

## Current status
## Implementation status on branch `v3-vanity-addresses`
- Solana vanity mint search uses the existing `tik` grinder and now fails closed instead of generating a normal mint when no matching key is found.
- Pooled Solana seeds are checked against both the stored public key and the `tik` suffix.
- EVM vanity search targets the case-insensitive `aaa` hex suffix and fails closed instead of issuing a random salt when no match is found.
- The EVM V3 launch contract now checks the deployed token address suffix on-chain and reverts if it does not end in `aaa`.
- Solana launch records reject mint addresses without the required suffix.
- This branch has not been built, tested, audited, or deployed. Existing deployed EVM contracts do not gain the new on-chain guard until the updated V3 contract is deployed and the launchpad registry is updated.
