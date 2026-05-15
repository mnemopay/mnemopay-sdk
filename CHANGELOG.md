# Changelog

All notable changes to `@mnemopay/sdk` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [1.8.0] — 2026-05-15

Native-shift Stage 1 promoted to stable. Recall + GridStamp anchor and the
governance primitives that were on the `alpha` dist-tag since 2026-05-14
are now the default. The first production consumer (`mnemopay-gateway`,
deployed 2026-05-15 to `mcp-gateway-api.fly.dev`) validated the surface
end-to-end against a live Supabase Postgres with RLS enforced.

All additive; no breaking changes to the 1.7.0 surface.

```bash
npm install @mnemopay/sdk          # 1.8.0
```

### Added (graduated from 1.8.0-alpha.0)

- **`@mnemopay/sdk/recall/anchor`** — the headline primitive. Each
  remembered piece of content produces a portable `MemoryAnchor`:
  - SHA-256 content fingerprint + Ed25519 signature by the owning
    Wallet's DID;
  - replay defenses via monotonic per-wallet `sequence`, 128-bit `nonce`,
    and `expires_at` TTL (default 30 days);
  - pluggable `NonceStore` interface (`InMemoryNonceStore` shipped;
    Redis-adapter shape compatible);
  - optional `gridstamp: GridStampSpatialProof` envelope for embodied
    agents — the proof is included in the signed payload so it cannot
    be swapped after mint;
  - `rollAnchorRoot()` Merkle-batches N anchors into a single hex root,
    so N memories can be checkpointed with one external write.
  See `examples/07-recall-anchor.ts` for the end-to-end flow.
- **`@mnemopay/sdk/governance/policy`** — sub-second policy enforcement
  (EU AI Act-shaped timer). Benchmarks over 5k evals: P50 3.7µs,
  P95 7.7µs, P99 ~100µs. Pure CPU path, zero allocs in the hot loop.
- **`@mnemopay/sdk/governance/policy-lint`** — compile-time validation of
  policy rule shapes so misconfigurations fail at startup, not at the
  first agent action.
- **`@mnemopay/sdk/governance/eu-ai-act`** — illustrative EU AI Act sample
  policy. Not legal advice; a copy-and-customise starting point for
  regulated buyers.
- **`@mnemopay/sdk/governance/approval`** — in-memory approval queue +
  `routeVerdict` helper for high-risk mission gates (HITL).
- **`@mnemopay/sdk/governance/audit-chain`** — shared event-stream Merkle
  audit. Consumed by `mnemopay-code` for mission audit bundles and
  `mnemopay-browser` for Article 12 session records.
- **`@mnemopay/sdk/governance/rate-counter`** — `RateCounter` interface
  (Redis-adapter shape).

### Tests

- 13 anchor specs (mint stability, nonce uniqueness, expiry,
  content/signature binding, Merkle root, replay rejection, no-DoS-on-fail)
  plus 3 new specs for the GridStamp envelope round-trip (signature
  binding, full verify, post-mint swap rejection).

### New subpath exports

- `@mnemopay/sdk/governance`
- `@mnemopay/sdk/governance/policy`
- `@mnemopay/sdk/governance/audit-chain`
- `@mnemopay/sdk/governance/approval`
- `@mnemopay/sdk/governance/eu-ai-act`
- `@mnemopay/sdk/recall/anchor`

### Compatibility

- Backward compatible with 1.7.0; only new symbols and new subpath
  exports. Existing `@mnemopay/sdk` root import behavior is unchanged.
- Continue using subpath imports (`/governance/policy`, `/recall/anchor`)
  rather than root import when you only need one module — root pulls
  in `dist/mcp/server.js` startup side-effects.

### Deferred to 1.8.1

- Auto-wiring `anchorMemory()` into the `RecallEngine.remember()` write
  path. The primitive is pure today (consumers wire it manually — see
  the example); engine-side hook is non-breaking and lands separately.

## [1.8.0-alpha.0] — 2026-05-14

Pre-release of the modules above on the `alpha` dist-tag. Superseded by
the 1.8.0 stable release on 2026-05-15. No behavioral differences;
graduation captures a real production deploy validating the surface
(`mcp-gateway-api.fly.dev` running 1.8.0-alpha.0 end-to-end with smoke
tests green).

## [1.7.0] — 2026-05-14

First native primitive of the trust-layer shift: portable agent identity.
Foundation for the forthcoming Recall+GridStamp anchor, MCP native
gateway, Browser thin layer, and Coding regulated-enterprise primitives —
every subsequent primitive consumes Identity for portable cross-platform
reputation.

```bash
npm install @mnemopay/sdk          # 1.7.0
```

### Added

- **`@mnemopay/sdk/identity`** — DID + Wallet primitive under the new
  `./identity` export subpath.
- **`did.ts`** — `mintDid`, `sign`, `verify`, `resolveDid`, `isDid`,
  `publicKeyMatchesDid`; types `Did` / `DidDocument` / `MintedDid`.
  Method `did:mp:<32-hex>` where the tail is the first 16 bytes of
  `SHA-256(SPKI-DER(ed25519-pubkey))`. Self-certifying — a verifier can
  confirm a DID document is authentic by hashing the embedded public key.
  128 bits of identifier entropy. v1 resolver is in-process; bundles
  auto-register on import.
- **`bundle.ts`** — `exportBundle`, `importBundle`, `canonicalize`
  (RFC 8785-compatible JCS for our shapes), `hashPaymentHistory`; types
  `IdentityBundle` / `IdentityBundlePayload` / `ExportBundleOptions`.
- **`wallet.ts`** — `Wallet.create` / `load` / `openOrCreate`; `sign`,
  `verify`, `exportBundle`, `fingerprint`, `persistToDisk`, `diskPath`.
  Private key state lives in a module-local `WeakMap` so neither
  `Object.keys` nor `JSON.stringify` can see it.

### Other

- Dashboard header now surfaces the current account + email when signed
  in, or shows "Not signed in" + the anonymous accountId fallback. Users
  could previously hit dashboard.mnemopay.com and not be able to tell
  which account context they were operating in.

### Compatibility

- Backward compatible with 1.6.x. Zero new runtime deps — uses
  `node:crypto` throughout.
- 36/36 identity specs passing (did 13, bundle 11, wallet 12). `tsc
  --noEmit` clean under `strict: true`.
- Tarball SHA `f009fce07fa6b81e2ede2758df080478bd275772`,
  441.9 KB packed / 1.9 MB unpacked, 255 files.

## [1.6.1] — 2026-05-13

Three "ready to take paying customers" hard blockers closed. All in the
MCP server + recall persistence layer.

```bash
npm install @mnemopay/sdk          # 1.6.1
```

### Fixed

- **HITL approval queue is now durable.** `pendingChargeRequests` and
  `pendingApprovals` were in-process `Map`s that silently vanished on pod
  restart. Now backed by SQLite via `src/storage/approval-queue.ts`;
  rehydrates on startup. Shop approvals rehydrate with a no-op resolve
  (the original `Promise` is dead, so settlement re-fires through the
  durable queue). 10-min expiry sweep, single-process writes. 6 specs.
- **Webhooks actually fire now.** `webhook_register` previously returned
  success without ever firing. New `src/storage/webhooks.ts` persists
  subscriptions with HMAC secret, enqueues deliveries via `fire()`,
  drains via `pumpOnce()` on a 2s `setInterval` with exponential backoff
  (1s → 32s, 6 attempts), DLQs to `status='dead'` after exhaustion.
  Signature uses the Stripe pattern:
  `X-MnemoPay-Signature: t=<unix>,v1=<hex-hmac-sha256(t + "." + body)>`.
  Wired into `charge`, `charge_approve`, `settle`, `refund`,
  `payout_create` success paths. 10 specs.
- **SQLiteAdapter for recall persistence.** New
  `src/recall/persistence/sqlite.ts` is the durable backing for recall
  events when running outside the in-memory mock. Brain bridge consumes
  it directly.

### Compatibility

- Wire-compatible with 1.6.0. New subpath imports `/storage/webhooks`
  and `/storage/approval-queue` are additive.

## [1.6.0] — 2026-05-11

Promotes the `1.6.0-alpha.{0,1,2}` line on the `alpha` dist-tag to a stable
release on `latest`. Rolls up four experimental rails and one auto-start
hardening fix into a single backward-compatible minor.

```bash
npm install @mnemopay/sdk          # now resolves to 1.6.0
```

### Added (stable)

- **`StripeMPPRail`** — Stripe Machine Payments Protocol rail, agent payments
  routed as crypto deposits on the Tempo network via Stripe's MPP-enabled
  PaymentIntents API. Pinned to `apiVersion: '2026-03-04.preview'`. Drop-in
  swap for `StripeRail`. (originally shipped in `1.6.0-alpha.0`)
- **`X402Rail`** — Coinbase x402 protocol rail (HTTP 402 revival). USDC on
  Base L2 via EIP-3009 `transferWithAuthorization` — agents sign off-chain,
  facilitator submits to chain on capture. Pluggable `X402Signer`, zero
  crypto deps in the SDK. (originally shipped in `1.6.0-alpha.1`)
- **`GoogleAP2Rail`** — Google Agent Payment Protocol (FIDO Alliance open
  standard, AP2 v0.2 — Human Not Present). Mandate VC + Intent VC + HTTP
  settlement. Pre-flight policy enforcement: mandate expiry, per-tx cap,
  rolling aggregate cap, currency match, recipient allow-list, credential
  match. Defense-in-depth. (originally shipped in `1.6.0-alpha.1`)
- **Spatial governance fold** (`src/governance/spatial.ts`) — GridStamp
  evidence adapter for embodied agents. `attachSpatialEvidence`,
  `verifySpatialEvidence`, `fingerprintSpatialEvidence` over a discriminated
  union of `GridStampSpatialProof` + `GridStampSplatEvidence`. Loose-coupled
  — no runtime dep on the `gridstamp` package. Article 12 bundle wiring
  emits `spatial.evidence` events in `events.json` + `events.csv`
  automatically. (originally shipped in `1.6.0-alpha.0`)

### Fixed

- **MCP server auto-start guard** — `src/mcp/server.ts` replaced the loose
  `process.argv[1]?.includes("mcp") || process.argv.includes("--start")`
  heuristic with the canonical CommonJS `require.main === module` check.
  The previous heuristic could false-fire when consumers imported
  `@mnemopay/sdk/mcp` from a process whose argv happened to contain the
  string `"mcp"` (e.g. browser bundlers, test runners under certain
  invocations). Confirmed in the wild by the `@blackpig/forge` browser
  consumer. Originally shipped in `1.6.0-alpha.2`.

### Public API additions in `src/index.ts` (since 1.5.0, additive only)

- `StripeMPPRail`, `X402Rail`, `GoogleAP2Rail`, `validateMandate`
- `attachSpatialEvidence`, `verifySpatialEvidence`, `fingerprintSpatialEvidence`
- `BASE_MAINNET_CHAIN_ID`, `BASE_SEPOLIA_CHAIN_ID`, `ETH_MAINNET_CHAIN_ID`,
  `USDC_CONTRACTS`, `USDC_DECIMALS`
- type exports: `StripeMPPOptions`, `X402Options`, `X402Signer`,
  `X402AuthorizationPayload`, `TransferWithAuthorizationTypedData`,
  `AP2Mandate`, `AP2Intent`, `AP2Signer`, `AP2Options`,
  `AP2SettlementResponse`, `AP2MandateValidation`, `SpatialEvidence`,
  `SpatialEvidenceVerifyResult`, `SpatialEvidenceRejectReason`,
  `GridStampSpatialProof`, `GridStampSplatEvidence`

### Compatibility

- Fully backward compatible with v1.5.0. No existing export was modified or
  removed; consumers on `latest` see only new symbols.
- `StripeMPPRail` requires `stripe@>=14.0.0` (already a peer dep) and an
  MPP-enabled Stripe account; falls back to `StripeRail` otherwise.
- `X402Rail` ships with zero crypto deps — consumers wire their own
  `X402Signer` (`viem` / `ethers` / `@noble/secp256k1`).
- `GoogleAP2Rail` ships with zero deps — consumers wire `AP2Signer` and
  the merchant AP2 settlement endpoint.
- Spatial fold is loose-coupled — works with or without `gridstamp`.

### Sister releases

- **`mnemopay@1.0.0`** (PyPI) — Python rail port at stable parity. Mirrors
  the TypeScript `PaymentRail` interface (sync API). Ships `MockRail` +
  `StripeRail`. The `1.0.0b1..b4` betas are superseded; `pip install mnemopay`
  now resolves to `1.0.0`.
- Hosted **MnemoPay console** at https://mnemopay-landing.fly.dev/ — Tier 1
  production blockers, Tier 2 observability, Tier 3 safety nets all in
  place (rate limiting, body-size caps, idempotent webhooks, structured
  JSON logging, Prometheus `/metrics`, graceful shutdown, CORS allowlist,
  security headers + tight CSP). `/readyz` returns `productionReady: true`.

## [1.6.0-alpha.2] — 2026-05-10

Third pre-release on the `alpha` dist-tag. One-line hardening fix folded in
from `224bec70` (2026-05-10).

### Fixed

- **MCP server auto-start guard** — switched from the loose `process.argv`
  heuristic to `require.main === module` in `src/mcp/server.ts`. Prevents
  spurious server starts when consumers `import` from `@mnemopay/sdk/mcp`
  in browser bundles or test harnesses. Surfaced by the
  `@blackpig/forge` browser consumer dogfooding `@mnemopay/sdk/recall`.

### Compatibility

- No public API change. Direct CLI invocation (`mnemopay-mcp`) still starts
  the server; library imports no longer can.

## [1.6.0-alpha.1] — 2026-05-08

Second pre-release on the `alpha` dist-tag. Adds the next two v1.6.x
rails on top of `1.6.0-alpha.0` (Stripe MPP + spatial governance):

```bash
npm install @mnemopay/sdk@alpha
```

The default `latest` dist-tag still points at `1.5.0` — stable users
are not affected. Sister Python release: `mnemopay@1.0.0b4` on PyPI.

### Added — experimental

- **`X402Rail`** — Coinbase x402 protocol rail (HTTP 402 Payment
  Required revival). USDC on Base L2 (chain id `8453`) via EIP-3009
  `transferWithAuthorization` — agents sign authorizations off-chain,
  facilitator endpoints submit to the chain on capture. 38 tests.
  - Pluggable `X402Signer` interface (bring-your-own crypto:
    `viem` / `ethers` / `@noble/secp256k1`) — SDK ships zero
    crypto deps
  - Hold = signed authorization (NOT broadcast yet)
  - Capture = submit to facilitator (chain settlement)
  - Reverse pre-capture = `reversed` (drop the signed auth);
    post-capture = `irreversible` (chain reality, surfaced in
    `PaymentRailResult.status`)
  - Helpers: `usdToUsdcBaseUnits`, `newNonce`,
    `buildTransferWithAuthorizationTypedData`
  - Constants: `BASE_MAINNET_CHAIN_ID`, `BASE_SEPOLIA_CHAIN_ID`,
    `ETH_MAINNET_CHAIN_ID`, `USDC_CONTRACTS` (frozen),
    `USDC_DECIMALS=6`
  - Default contract: USDC on Base mainnet
    (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)

- **`GoogleAP2Rail`** — Google Agent Payment Protocol (FIDO Alliance
  open standard, AP2 v0.2 — Human Not Present). Mandate Verifiable
  Credential signed by the principal + Intent VC signed by the agent
  + HTTP settlement to the merchant's AP2 endpoint. 41 tests.
  - Pluggable `AP2Signer` interface
  - **Pre-flight policy enforcement** before any signature is produced:
    mandate expiry, per-tx cap, aggregate cap (rolling), currency
    match, allowed-recipients allow-list, signer credential matches
    mandate. Defense-in-depth — the SDK refuses to build an Intent VC
    that violates the mandate, even if the merchant would accept it.
  - Hold = build + sign Intent VC
  - Capture = HTTP `POST` `{mandate, intentId}` with header
    `x-ap2-version: 0.2`
  - Helpers: `validateMandate`, `usdToMinorUnits`, `newIntentNonce`,
    `newIntentId`

### Public API additions in `src/index.ts` (additive, no breaking changes)

- `X402Rail`, `GoogleAP2Rail`, `validateMandate`
- `BASE_MAINNET_CHAIN_ID`, `BASE_SEPOLIA_CHAIN_ID`,
  `ETH_MAINNET_CHAIN_ID`, `USDC_CONTRACTS`, `USDC_DECIMALS`
- type exports: `X402Options`, `X402Signer`,
  `X402AuthorizationPayload`, `TransferWithAuthorizationTypedData`,
  `AP2Mandate`, `AP2Intent`, `AP2Signer`, `AP2Options`,
  `AP2SettlementResponse`, `AP2MandateValidation`

### Compatibility

- Fully backward compatible with v1.5.0 and v1.6.0-alpha.0. No
  existing consumer sees an API change.
- x402 has zero new runtime deps; the SDK does not import any crypto
  library — consumers wire their own signer.
- AP2 has zero new runtime deps; signer + settlement endpoint are
  consumer-supplied.

### Sister release

- **`mnemopay@1.0.0b4`** (PyPI) — Python rail port. Mirrors the
  TypeScript `PaymentRail` interface (sync API). Ships `MockRail` +
  `StripeRail` (lazy `import stripe` peer-dep, threading.Lock-based
  capture race-protection, idempotency-key forwarding,
  `create_customer` + `create_setup_intent` helpers). 29 new tests,
  full suite 422/422 green.

## [1.6.0-alpha.0] — 2026-05-08

Pre-release published under the `alpha` npm dist-tag. The default
`latest` dist-tag still points at `1.5.0`. Opt in with:

```bash
npm install @mnemopay/sdk@alpha
```

The full `1.6.0` minor will ship when the v1.6.x rail sprint completes
(Stripe MPP + x402 + Google AP2, all native, with Python rail port).
This alpha cuts the first two real deliverables.

### Added — experimental

- **`StripeMPPRail`** — Stripe Machine Payments Protocol rail, the first
  cross-rail v1.6.x adapter. Routes agent payments as crypto deposits on
  the Tempo network via Stripe's MPP-enabled PaymentIntents API. Pinned
  to API version `2026-03-04.preview`. Same `PaymentRail` interface as
  `StripeRail`, drop-in swap. 20 tests.
  - `payment_method_types: ["crypto"]` + `crypto.deposit_options.networks`
  - `capture_method: "manual"` two-phase escrow
  - In-flight capture deduplication
  - Idempotency-key forwarding
  - `fromClient(client, opts?)` for tests + shared Stripe client patterns
  - Tagged `@experimental` — preview API can change without semver
    guarantees from Stripe; pin `apiVersion` in production

- **Spatial governance fold** (`src/governance/spatial.ts`) — GridStamp
  evidence adapter for embodied agents. Loose coupling: NO dependency
  on the `gridstamp` npm package. Define the structural shape MnemoPay
  expects to receive (mirrored from gridstamp's published types) and
  fail-closed verifier. 19 tests.
  - `attachSpatialEvidence(audit, evidence)` — records `spatial.evidence`
    event in MerkleAudit chain with content fingerprint
  - `verifySpatialEvidence(e)` — structural integrity check
  - `fingerprintSpatialEvidence(e)` — deterministic SHA-256 over
    canonical JSON (sorted-keys replacer)
  - Types: `SpatialEvidence` (discriminated union of
    `GridStampSpatialProof` + `GridStampSplatEvidence`),
    `SpatialEvidenceVerifyResult`, `SpatialEvidenceRejectReason`
  - Article 12 bundle integration: `spatial.evidence` events appear in
    `events.json` + `events.csv` exports automatically

  Pairs with `gridstamp` master commit `559e26c` (2026-05-08) — completes
  the SPZ-4 (Niantic Gaussian splat) evidence adapter sitting uncommitted
  since 2026-05-06.

### Public API additions in `src/index.ts` (additive, no breaking changes)

- `StripeMPPRail`
- `attachSpatialEvidence`, `verifySpatialEvidence`, `fingerprintSpatialEvidence`
- type exports: `StripeMPPOptions`, `SpatialEvidence`,
  `SpatialEvidenceVerifyResult`, `SpatialEvidenceRejectReason`,
  `GridStampSpatialProof`, `GridStampSplatEvidence`

### Compatibility

- Fully backward compatible with v1.5.0. Existing consumers see no API
  change.
- Stripe MPP rail requires `stripe@>=14.0.0` (already a peer dep) +
  Stripe API access. Falls back to existing `StripeRail` if MPP is not
  enabled on the account.
- Spatial fold is loose-coupled — the SDK works with or without the
  `gridstamp` package on the consumer side.

## [1.5.0] — 2026-05-06

### Added

- **Governance module** (`src/governance/`). Folds the Charter, FiscalGate,
  Article 12 audit-bundle, and MerkleAudit primitives — previously published
  under `@kpanks/{core,payments}` — into `@mnemopay/sdk` as first-class
  modules. Phase 1 of the Praetor → MnemoPay platform consolidation.
  - `MerkleAudit` — sha256-chained event log with `verify()`, `toJSON()`,
    listener subscriptions, deterministic replay.
  - `Charter` schema + `validateCharter()` — declares an agent mission's
    goal, allowed tools, and budget cap.
  - `runMission(ctx)` — the FiscalGate primitive. Reserves the full
    charter budget up-front, runs the agent loop, settles actual spend on
    success, releases on halt/error. Returns `{ status: "ok" | "halted" |
    "error", spentUsd, outputs, auditDigest, ... }`.
  - `buildArticle12Bundle({ charter, result, audit })` — produces a
    regulator-handable bundle (mission.json, events.json, events.csv,
    chain.txt, manifest.json with checksums + retention metadata).
    Defaults to 6-month retention per EU AI Act Article 12. Bundle has
    a deterministic SHA-256 digest for tamper detection.
  - `PaymentsAdapter` interface + `MockPayments` reference implementation.
- **11 governance tests** in `tests/governance.spec.ts` covering charter
  validation, MerkleAudit chain + tamper detection, FiscalGate happy /
  halt / error paths, Article 12 bundle file count + checksums + default
  retention.

### Changed

- **Public API exports** in `src/index.ts` — additive only. New exports:
  `MerkleAudit`, `validateCharter`, `runMission`, `buildArticle12Bundle`,
  `MockPayments`, plus accompanying types (`AuditEvent`, `Charter*`,
  `MissionResult`, `MissionContext`, `Article12Bundle*`, `PaymentsAdapter`).
  No existing exports were modified or removed.

### Compatibility

- Fully backward compatible with v1.4.2. Existing consumers see no API
  change. The `@kpanks/{core,payments}` packages remain published for
  consumers that haven't migrated; new code should prefer the
  `@mnemopay/sdk` exports.

## [1.4.0] — 2026-04-20

### Security

- **Replay-attack protection restored.** From v1.2.0 through v1.3.1 the
  `reason` argument passed to `charge()` was not being forwarded into the
  fraud engine, leaving `ReplayDetector` without the third component of its
  fingerprint. A second identical charge inside the 60-second window was
  therefore not detected as a replay. Fixed in `src/index.ts` by forwarding
  `reason` into `FraudGuard.assessCharge()`.
- **Composite risk score: critical-severity floor.** When any single fraud
  signal carries `severity: "critical"`, the composite score is now forced
  to `1.0` regardless of the weighted-average result. Previously a single
  critical signal could be diluted by other low-severity signals and slip
  under `blockThreshold`. The 60-second duplicate-fingerprint signal was
  also upgraded from `high` (weight 0.6) to `critical` (weight 0.9), giving
  replay attempts a hard block under the default config.
- **`CommerceEngine.purchase()` idempotency.** The charge `reason` now
  includes the `orderId` so sequential autonomous purchases of the same
  product don't trip the replay detector. Models the real-world invariant
  that every purchase is a distinct order.

### Added

- **1M-transaction stress harness** (`tests/stress/stress-1m.test.ts`).
  100 agents × 10,000 ops, mixed workload, 2% adversarial replay injection,
  p99 latency SLO, global ledger integrity check. Companion tests at 300K
  and 500K remain in the suite.
- **`BENCHMARKS.md`** at repo root — reproducible 300K / 500K / 1M
  benchmark results. Verified $15.1M simulated value, $0.00 ledger drift,
  100.0% adversarial detection at the top scale.
- **Replay-detection regression tests** appended to `tests/fraud.test.ts`.
  Three tests cover: (a) second identical charge within 60s throws,
  (b) different reasons allow repeated charges with the same amount,
  (c) direct `FraudGuard.assessCharge()` unit test proving the composite is
  forced to 1.0 on critical signals.

### Changed

- `.gitignore` — excludes heavy research artifacts (`benchmark/longmemeval/results/`,
  `bge-model/`, temp run logs, `*.eval-results-gpt-4o`) from source control.

## [1.3.1] — 2026-04-16

### Security

- `cli/dashboard.ts`: `child_process.exec` → `execFile` so the
  browser-open URL can't be interpreted as shell input. Eliminates a command
  injection vector on any env that hands a user-controlled dashboard URL to
  the CLI.
- `commerce/checkout/executor.ts`: screenshot filenames are sanitized
  (`/`, `\`, `.` → `_`) before being written. Prevents path traversal when a
  caller passes an attacker-controlled name.
- `fraud.ts`, `fraud-ml.ts`: all `deserialize()` paths now validate JSON
  shape + cap array sizes (edges ≤100k, agentStats ≤50k, trees ≤500, ips
  per agent ≤1k, etc.) before populating Maps/Sets. Silent `catch {}` blocks
  replaced with logged errors so persistence corruption is observable.
- `mcp/server.ts webhook_register`: webhook URLs now require `https://` and
  reject private/link-local hosts (`localhost`, `127.*`, `10.*`, `192.168.*`,
  `169.254.*`, `::1`). Closes an SSRF hole where a registered webhook could
  be used to probe the local network.
- `mcp/server.ts startServer`: `PORTAL_URL` is validated at boot; a non-HTTPS
  value in production exits immediately instead of silently downgrading portal
  auth.
- `MnemoPayLite` persistence: removed dead-code path that double-deserialized
  `fraudGuard` and partially mutated the existing guard before replacing it.
  Restore is now a single atomic assignment.

### Removed

- `from-source` dependency (was pulled in transitively, no longer needed).

## [1.3.0] — 2026-04-15

### Breaking

- **MCP server default tool group is now `essentials` (not `all`).** Running
  `npx @mnemopay/sdk` or `npx @mnemopay/mcp-server` without a `--tools` flag now
  exposes 14 tools (~1K tokens of context) instead of 40 tools (~3.8K tokens).
  This makes MnemoPay one of the lightest MCP servers a user can install —
  most agent workloads only need memory + wallet + tx, and paying 3.8K tokens
  of tool schemas on every turn for unused commerce/webhook/security surface
  area was the single biggest complaint from early adopters.

  **`essentials` includes:**
  - `memory`: `remember`, `recall`, `forget`, `reinforce`, `consolidate`
  - `wallet`: `balance`, `profile`, `history`, `logs`
  - `tx`: `charge`, `settle`, `refund`, `dispute`, `receipt_get`

  **To restore the previous behavior** (all 40 tools), pass `--tools=all` or
  set `MNEMOPAY_TOOLS=all`:

  ```bash
  npx @mnemopay/sdk --tools=all
  # or in claude_desktop_config.json / mcp.json:
  { "mnemopay": { "command": "npx", "args": ["-y", "@mnemopay/sdk", "--tools=all"] } }
  # or via env:
  MNEMOPAY_TOOLS=all npx @mnemopay/sdk
  ```

  **Other presets:**
  - `--tools=agent` — essentials + commerce + hitl + payments + webhooks (agent workloads)
  - `--tools=memory,wallet` — mix-and-match individual groups by name
  - `--tools=fico,security` — FICO scoring + integrity tooling only

  Available groups: `memory`, `wallet`, `tx`, `commerce`, `hitl`, `payments`,
  `webhooks`, `fico`, `security`. Aliases: `essentials`, `agent`, `all`.

### Why the default changed

Context is the scarcest resource in an agent loop. Every tool schema MnemoPay
registers is a token the model pays on every turn, whether the tool is called
or not. At 40 tools MnemoPay was a tax on context budgets; at 14 it's
negligible. Users who need the full surface can opt in explicitly — but
defaulting to "everything" punished the 80% of installs that just want memory
and a wallet.

### Migration

| Previous behavior                       | v1.3.0 equivalent                |
|-----------------------------------------|----------------------------------|
| `npx @mnemopay/sdk`                     | `npx @mnemopay/sdk --tools=all`  |
| Using `commerce`/`hitl` tools by default | Add `--tools=agent`              |
| Using `webhook_register` by default     | Add `--tools=essentials,webhooks`|

No SDK API changes. TypeScript types, middleware, and REST client are
untouched. This release only rescopes the MCP server's default tool
exposure.

---

## [1.2.0] — prior

Agent FICO (300–850), Merkle integrity, behavioral finance, EWMA anomaly
detection, canary honeypots, HMAC-SHA256 signing, full payment rails
(Stripe / Paystack / Lightning), autonomous shopping with escrow, HITL
approval, 716 tests.
