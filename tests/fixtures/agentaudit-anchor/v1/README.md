# mnemopay-anchor fixture v1

A fixed MnemoPay AuditChain bundle anchored through
`@agentauditai/mnemopay-anchor` (`AuditVaultAnchorSink` → AuditVault v2 `commitBatch`).
It is meant to be shared with MnemoPay, so both sides can check the same bytes.

| File | Contents |
|---|---|
| `bundle.json` | `ChainBundle` v1: 3 events with fixed ids and timestamps, `built_at` `2026-10-27T12:00:03.000Z` |
| `expected.json` | Inputs, derived values, the expected `AnchorReference`, the full anchor record and the anchored `meta` |

## What is pinned

**Pinned (environment-independent):**
- `merkle_root`, which `verifyBundle` recomputes
- `sha256(producerId)`
- `contentURI`
- `eventCount` and `complianceScore`
- `commitBatch` calldata
- `rootCommitment`

**Environment-dependent:** `txHash`, `vaultAddress`, `agentId`, `batchIndex` and
`blockNumber`. These reproduce only on a fresh `anvil` (Foundry v1.7.1 defaults,
chain id 31337):
1. Account #0 (the public test key) deploys `out/AuditVault.sol/AuditVault.json` at nonce 0.
2. The sink anchors `bundle.json` as its first `commitBatch`, at nonce 1.

Any other chain, signer, nonce or fee market gives different values for these fields.

## Checked by

- `packages/mnemopay-anchor/test/fixture.test.ts` checks everything that can be
  checked offline.
- `packages/mnemopay-anchor/test/fixture.anvil.test.ts` reproduces the whole
  `expected.json`, including `txHash`, on a fresh anvil.

Regenerating changes `txHash` only if the deploy or anchor sequence changes. Do
not edit these files by hand. If the format changes, add a `v2/` directory.
