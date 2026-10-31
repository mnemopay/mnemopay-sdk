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

## Derived fields

`expected.json` → `derived`. Code references are to the AgentAudit repo
(`agentauditAI/AgentAudit`): the sink is `packages/mnemopay-anchor/src/index.ts`, and the
checks are in `packages/mnemopay-anchor/test/fixture.test.ts`.

| Field | Meaning | How computed | Value here |
|---|---|---|---|
| `merkle_root` | MnemoPay `ChainBundle.merkle_root`, passed through unchanged | MnemoPay `AuditChain.rollMerkleRoot()` over the bundle's events. `verifyBundle()` recomputes it | `fac91804…0803f` (bare lowercase hex) |
| `merkle_root_bytes32` | The same root as the `bytes32` that goes on-chain: the `merkleRoot` argument of `commitBatch` and the `merkleRoot` of the `LogBatchCommitted` event | `toBytes32Root(merkle_root)`: adds `0x`, lowercases, rejects a zero root | `0xfac91804…0803f` |
| `producer_id_sha256` | The only form of the producer id that goes on-chain | `hashProducerId(inputs.producer_id)` = SHA-256 of the UTF-8 string `mnemopay/fixture`, lowercase hex | `00c8b85b…5f261` |
| `content_uri` | `contentURI` argument of `commitBatch`. A locator label, not a fetchable URL | `anchorContentURI(namespace, producer_id, sealed_at)` = `<namespace>:<producer_id_sha256>:<sealed_at>`, where `sealed_at` = the bundle's `built_at` | `mnemopay:00c8b85b…5f261:2026-10-27T12:00:03.000Z` |
| `event_count` | `eventCount` argument (`uint256`) of AuditVault v2 `commitBatch`. **Not** the number of events in `bundle.json`, and not a count of on-chain logs (one `commitBatch` always emits one `LogBatchCommitted`) | `eventCountFromMeta(bundle.meta)`: `meta.event_count` if it is a positive safe integer, else `1`, meaning "one root". This bundle's `meta` has no `event_count`, so the sink's default applies. A producer who wants the bundle's event total recorded on-chain sets `meta.event_count` before anchoring | `1` (the bundle has 3 events) |
| `compliance_score` | `complianceScore` argument (`uint8`, 0–100) of AuditVault v2 `commitBatch` | Constant `COMPLIANCE_SCORE = 0` ("unscored"). The sink always sends `0`. In v2 this value is self-reported by whoever calls `commitBatch` and is not authenticated, so it is not evidence of anything. AuditVault v3 drops it (`docs/design/AUDITVAULT_V3.md` §13 Q11) | `0` |
| `commit_batch_calldata` | The exact transaction input the sink sends | ABI encoding of `commitBatch(anchor_record.agentId, merkle_root_bytes32, content_uri, event_count, compliance_score)`, selector `0x97758584`. It contains `agentId`, the sink signer's address (anvil account #0, `0xf39F…2266`), so it is pinned **for that signer**. With another signer only the 32-byte `agentId` word differs | see `expected.json` |

## Checked by

- `packages/mnemopay-anchor/test/fixture.test.ts` checks everything that can be
  checked offline.
- `packages/mnemopay-anchor/test/fixture.anvil.test.ts` reproduces the whole
  `expected.json`, including `txHash`, on a fresh anvil.

Regenerating changes `txHash` only if the deploy or anchor sequence changes. Do
not edit these files by hand. If the format changes, add a `v2/` directory.
