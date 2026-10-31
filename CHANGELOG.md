# Changelog

All notable changes to `@mnemopay/sdk` are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [1.15.0] - 2026-10-30

Adds the `OnChainAnchorSink` seam, fixes the ledger silently losing its audit trail,
and fixes silent cross-process memory loss. Minor release (new module, additive API),
per [VERSIONING.md](VERSIONING.md). Backward compatible with 1.14.2; the Ledger
changes below are behaviour fixes worth reading before you upgrade.

### Added

- **`@mnemopay/sdk/governance/anchor-sink` — `OnChainAnchorSink`.** The seam an external
  anchoring provider plugs into, so a verifier can check that an `AuditChain` Merkle
  root existed at a point in time without trusting the operator. `anchor({ producerId,
  merkleRoot, bundleMeta, sealedAt })` returns `{ anchorId }`; `status(anchorId)` resolves
  to `pending | anchored | failed`. Ships with `anchorChainBundle()`,
  `attachAnchorReference()`, `pollAnchor()` and a `MockAnchorSink`. Interface and mock
  only: no chain code, ABI or gas handling lives in the SDK. What an anchor *proves*
  depends on the sink: AuditVault v2, for example, does not authenticate the submitter,
  so it shows a root existed at block T, not which producer committed it.
- **Dashboard billing:** Stripe checkout now sends an explicit `payment_method_types`
  (default `card` + `us_bank_account`), overridable with
  `STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES`.
- `tests/live-stripe.test.ts` — opt-in Stripe **test-mode** settlement check; skipped
  unless `STRIPE_TEST_KEY=sk_test_...` is set and refuses any other key.

### Fixed

- **The ledger silently stopped recording entries.** `Ledger.compact(n)` with `n <= 100`
  permanently switched entry recording off, and `MnemoPayLite` calls `compact(50)`, so
  after roughly ten settlements the ledger kept running totals but no entries — balanced,
  yet unauditable. `compact()` now only trims, keeps the hash-chain link, and exposes
  `archiveSink` to capture dropped entries. Dropping the audit trail is now an explicit
  `setHighThroughput(true)`.
- **Ledger tampering that went undetected.** The entry hash now covers every field
  (it omitted `description`, `createdAt`, `relatedTxId`, ...); an entry with its
  `prevEntryHash` stripped is reported broken instead of skipped as legacy; truncation of
  the newest entries is caught via a recorded head hash; `reconcile()` catches edited
  balance totals. Ledgers persisted by earlier versions still verify.
- **Partial settlements.** `recordSettlement()` validates `fee + net == gross` (±0.01)
  before recording any leg, so a bad amount can no longer leave funds stranded.
- **Concurrent writers** no longer erase each other's memories.** `_saveToDisk()`
  wrote an instance's *entire* state over the shared persist file while
  `_loadFromDisk()` ran only once, at construction. Any process holding the same
  `agentId` — every MCP server instance does — overwrote memories another
  process had stored since its own load, and the 30s auto-save made the loss
  certain: an idle instance erased a busy one's writes, then the next save copied
  the emptied file over `.bak`, taking the backup with it. `_saveToDisk()` now
  folds in rows written by other processes before overwriting.
- **Deletions survive the merge.** `forget()` and `consolidate()` record
  tombstones in a shared `forgottenIds` list (capped at `MAX_TOMBSTONES`, 1000)
  honoured by both the loader and the merge, so a stale instance cannot
  resurrect a deleted memory.

### Changed

- `Ledger.compact()` returns the dropped entries (it returned `void`) and now throws unless
  `maxEntries` is a positive integer.
- `Ledger.verify()` also returns `auditTrail` (`complete | compacted | disabled`) and, when
  provable, `reconciled`. `verifyChain()` may return `headMatches`.
- New ledger entries carry `hashVersion: 2`. `MnemoPayLite` logs and audits a failed ledger
  chain or reconcile check when loading persisted state.
- Docs: the reputation score is no longer called "Agent FICO".

### Notes

- Only memories are merged. Wallet, ledger, counters and fraud state remain
  last-writer-wins by design: folding financial state from two writers risks
  double-counting balances, which is worse than a stale number.
- This narrows the loss window from the full 30s auto-save interval to the
  microseconds between the pre-write read and the rename. It is **not** a lock;
  a true cross-process guarantee needs file locking or a per-memory append log.

## [1.14.1] - 2026-06-24

Docs + examples for the Swarm product loop. No runtime API changes — fully backward compatible with 1.14.0.

### Added

- **Example 12 (`examples/12-swarm-catalog-demo.ts`)** — catalog → `Swarm` → audit JSONL → ledger receipt end-to-end demo.
- **`docs/jkai-swarm-demo-short.md`** — JKAI short script for the `@mnemopay/swarm` launch.

### Changed

- **Swarm stability** — README and `src/swarm/index.ts` now document Swarm as **stable since 1.11.0** (was alpha-framed).
- **Examples index** — lists example 12.

### Ecosystem

- **`@mnemopay/swarm@0.1.0`** — new CLI on npm (`list`, `install`, `demo`, `run`).
- **Skill catalog** — three verified partner skills (`mnemopay/sdk`, `mnemopay/browser`, `mnemopay/swarm`) on `mcp.mnemopay.com`.

## [1.13.1] - 2026-06-13

Ships the `./recall/postgres` subpath export that landed on master
(PostgresAdapter, PRs #16/#23) but was omitted from the 1.13.0 npm tarball —
the 1.13.0 publish ran from a tree captured before that export was added to
`package.json`, so consumers could not import `@mnemopay/sdk/recall/postgres`
from 1.13.0 even though the compiled file shipped. 1.13.0 is immutable on npm,
so this patch republishes the complete export map. Fully backward compatible.

### Added

- **`PostgresAdapter` (`@mnemopay/sdk/recall/postgres`)** — vendor-neutral
  pgvector-backed recall persistence adapter for any Postgres (Neon, Supabase,
  Amazon RDS/Aurora, Cloud SQL, or self-hosted). Subclass of the existing
  `NeonAdapter` with an identical config shape; exposed so standalone SDK
  consumers can discover it by name and via the `{ type: "postgres", url }`
  persistence option. Requires the optional `pg` peer dep, dynamically
  imported on first query. This export was missing from the 1.13.0 tarball.

## [1.13.0] - 2026-06-13

Additive minor: two new LLM-provider memory middlewares plus a normalized
payment-rail capture-error type. Fully backward compatible with 1.12.x —
only new symbols and new subpath exports.

### Added

- **Cohere middleware (`@mnemopay/sdk/middleware/cohere`)** — memory-injecting
  wrapper for a `cohere-ai` v2 client. `CohereMiddleware.wrap(cohere, agent,
  { recallLimit? })` returns a proxy whose `cohere.chat({ model, messages })`
  recalls the top memories, injects them as a system turn, calls Cohere, and
  stores the exchange via `agent.remember(...)`. Handles the Cohere v2
  content-block-array response shape (`response.message.content[].text`).
  Same recall → inject → store → return contract as the OpenAI / Anthropic /
  Gemini middlewares.
  ```ts
  import { CohereClientV2 } from "cohere-ai";
  import { CohereMiddleware } from "@mnemopay/sdk/middleware/cohere";

  const cohere = CohereMiddleware.wrap(new CohereClientV2({ token }), agent);
  const r = await cohere.chat({ model: "command-r-plus", messages: [...] });
  ```
- **Mistral middleware (`@mnemopay/sdk/middleware/mistral`)** — memory-injecting
  wrapper for a `@mistralai/mistralai` client. `MistralMiddleware.wrap(client,
  agent, { recallLimit? })` proxies `client.chat.complete({ model, messages })`
  (one level deeper than OpenAI's `chat.completions.create`), injecting recalled
  memories and persisting the exchange. OpenAI-compatible request/response
  shape (`choices[0].message.content`).
- **`RailCaptureError` (`@mnemopay/sdk/rails`)** — normalized capture-failure
  error for payment rails. Wraps the raw provider error (Stripe `APIError`,
  fetch `TypeError`, LND HTTP body, …) in a consistent shape while preserving
  the underlying cause via `.originalError` (and `Error.cause`), and attaches
  an actionable `hint` derived from the failure mode (insufficient funds,
  idempotency reuse, expired auth, rate limit, auth/credentials, not-found,
  network unreachable). Companion `runRailCapture(railName, ctx, exec)` helper
  wraps a rail's capture execution and is idempotent (an existing
  `RailCaptureError` is rethrown unchanged). Wired through the Paystack,
  x402, and Google AP2 rail capture paths.
- **New subpath exports** — `@mnemopay/sdk/middleware/cohere` and
  `@mnemopay/sdk/middleware/mistral`.

### Tests

- `tests/middleware/cohere.test.ts`, `tests/middleware/mistral.test.ts`, and
  `tests/rail-capture-error.test.ts` cover wrap shape, recall hook, custom
  `recallLimit`, system-context injection, `agent.remember` write,
  provider-error passthrough, and the capture-error hint mapping. Mocked
  provider SDKs — no real network calls.

### Docs

- Added bundler/runtime integration guides: `docs/INTEGRATION-BUN.md`,
  `docs/INTEGRATION-VITE.md`, `docs/INTEGRATION-WEBPACK.md`, plus the
  official MCP registry manifests (`server.json`, `server.dns.json`) and
  registry-publishing notes.

## [1.12.1] - 2026-06-08

### Added

- Expanded the unified MCP server to 95 tools, including governance,
  action-ledger, identity, governed-skill, GridStamp spatial-evidence,
  Agent OS job, organization administration, and operator-control tools.
- Added durable MCP controls for hosted browser, code, computer, skill, and
  brain jobs, including retries, cancellation, alerts, usage, and audit export.
- Added organization member, invitation, policy, agent, limit, approval,
  process pause/resume, and emergency-stop controls.

### Fixed

- Clean `dist` before builds and exclude internal tests and benchmarks from
  published npm packages.
- Updated the legacy AgentFICO validation assertion to the current Agent
  Reputation Scoring terminology.

## [1.11.1] - 2026-05-26

### Security

- Replaced deprecated `@xenova/transformers` with
  `@huggingface/transformers@^4.2.0`, removing the vulnerable
  `onnxruntime-web -> onnx-proto -> protobufjs` runtime dependency path.

## [1.11.0] — 2026-05-21

Consolidates [1.11.0-alpha.0] and [1.11.0-alpha.1] into a stable release.
Public API is now frozen for the 1.11.x line.

### Added

- **Gemini middleware (`@mnemopay/sdk/middleware/gemini`)** — memory-injecting
  wrapper for `@google/generative-ai` clients. Same shape as the existing
  OpenAI / Anthropic `wrap` middlewares: `GeminiMiddleware.wrap(genAI, agent,
  { recallLimit? })` returns a proxy whose every `getGenerativeModel(...)`
  returns a model with `generateContent` (and `startChat().sendMessage`)
  auto-injecting recalled memories into `systemInstruction` and storing the
  exchange via `agent.remember(...)`. Unlocks MnemoPay for Build with Gemini
  XPRIZE submissions.
  ```ts
  import { GoogleGenerativeAI } from "@google/generative-ai";
  import { GeminiMiddleware } from "@mnemopay/sdk/middleware/gemini";

  const raw = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const genAI = GeminiMiddleware.wrap(raw, agent);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const r = await model.generateContent("Plan my Tuesday.");
  ```
- **`@google/generative-ai` declared as `peerDependenciesMeta.optional`** —
  install the SDK without it; install `@google/generative-ai` only when you
  actually use the Gemini middleware.
- **10 new tests** in `tests/middleware/gemini.test.ts` covering wrap shape,
  recall hook, custom `recallLimit`, systemInstruction injection (default
  + caller-supplied), `agent.remember` write, provider-error short-circuit,
  passthrough response, non-blocking `remember` failures, and the
  `startChat().sendMessage` chat-session path. Mocked Google SDK — no real
  network calls.

### Promoted from alpha

All of the following landed in 1.11.0-alpha.0 (2026-05-19) and are now
stable. No API changes between alpha and 1.11.0.

## [1.11.0-alpha.0] — 2026-05-19

### Added

- **BrowserSwarm (`@mnemopay/sdk/swarm/browser`)** — extends the v0.1 `Swarm`
  with native browser-session orchestration. New surface:
  - `BrowserSwarm extends Swarm` — `spawn(BrowserTask[])` now opens N parallel
    browser sessions (one per task), each session driven by a typed step
    sequence: `goto` / `act` / `extract` / `screenshot` / `wait`.
  - `BrowserTaskResult` carries `finalUrl`, `screenshots: string[]` (base64
    PNGs from screenshot steps), `extractedData: unknown[]` (one entry per
    extract step) — in addition to the inherited `ok` / `spend` / `auditRef`
    / `error`.
  - Wires through `@mnemopay/browser` (optional peer dep, lazy-imported) for
    real session lifecycle. Stagehand / local Playwright / Browserbase all
    routable via `cfg.browser.provider`.
  - Per-step audit-chain events (`browser.step` with `{taskId, stepType, ts,
    success, ...stepDetails}`) plus the existing per-task `swarm.task` event.
  - Per-session billing-meter wiring (`emitStart` / `emitEnd`) — best effort;
    meter failures never block tasks.
  - Per-session failure isolation — one bad step or open() failure marks
    that task `ok:false` and `error: "provider-error: ..."` but lets sibling
    sessions complete cleanly.
  - Per-agent FiscalGate.precheck + total-budget envelope inherited from
    base `Swarm`. Denied tasks never open a session.
- **`@mnemopay/browser` added as `peerDependenciesMeta.optional`** — install
  the SDK without it; install `@mnemopay/browser` (which transitively pulls
  Playwright) only when you actually use `BrowserSwarm`.
- **5 new tests** in `src/swarm/browser.test.ts` covering parallel-N session
  open, per-session budget enforcement, full step sequence execution,
  audit-chain integration, and per-session failure isolation. All run
  against a mock surface — no Playwright in CI.
- **File-backed `AuditChain` (`@mnemopay/sdk/governance/audit-chain`)** — the
  constructor now accepts `{ path?: string }`. When provided, every `emit()`
  appends the event as one JSONL line to that path (`appendFileSync`,
  best-effort sync; disk failures `console.warn` and never throw). The
  in-memory tail is preserved so `rollMerkleRoot()` / `toBundle()` behave
  identically to the in-memory-only mode. New method `rollAndExport({
  pathOut, meta? })` writes a JSON snapshot of the full bundle. Replaces the
  25-line `FileAuditChain` shim that bizsuite-site + mcp-gateway were
  carrying as a downstream subclass.
  ```ts
  import { AuditChain } from "@mnemopay/sdk/governance/audit-chain";
  const chain = new AuditChain({ path: "./.audit-chain/llm.jsonl" });
  ```
- **Streaming interception in audit-only middleware** — both
  `AnthropicMiddleware.audit(...)` and `OpenAIMiddleware.audit(...)` now wrap
  the streaming surfaces:
  - `client.messages.stream(...)` (Anthropic) — taps the async iterator,
    accumulates `text_delta` chunks + `message_start` / `message_delta`
    usage, emits exactly one `llm.call` event at close with `streaming:
    true` and `partial: false`. Consumer-cancelled streams emit `partial:
    true` with tokens-so-far.
  - `client.chat.completions.create({ stream: true })` (OpenAI) — same
    shape; set `stream_options: { include_usage: true }` to surface the
    final usage block, otherwise `output_tokens` falls back to chunk count.
  - The wrapper does NOT change the streaming API surface — consumers still
    `for await (...)` exactly as before. Closes the silent audit gap in
    1.10.1-alpha.0 (only `.create` was intercepted; `.stream` bypassed).
- **4 new tests** in `tests/middleware-stream-audit.test.ts` covering
  Anthropic + OpenAI full-stream and cancelled-stream paths against mock
  providers (no `@anthropic-ai/sdk` or `openai` required in CI).
- **2 new tests** in `tests/audit-chain.test.ts` covering path-backed
  append + back-compat in-memory mode.

### Notes

- Alpha — public API may shift before 1.11.0 final. Build with us.
- BrowserSwarm does NOT modify the v0.1 `Swarm` class; it only extends it.
- Stagehand's natural-language `act()` and `extract()` route through the
  surface's `evaluate()` shape so the underlying provider can dispatch
  appropriately — no second action vocabulary on the SDK side.

## [1.10.1-alpha.0] — 2026-05-18

### Added

- **Audit-only middleware variants** — `AnthropicMiddleware.audit(client, opts)`
  and `OpenAIMiddleware.audit(client, opts)`, exposed as new subpath exports
  `@mnemopay/sdk/middleware/anthropic-audit` and `@mnemopay/sdk/middleware/openai-audit`.
  Unlike the original `.wrap(...)` variants, the audit factories:
  - Forward every `messages.create` / `chat.completions.create` call **unchanged** —
    no system-prompt injection, no memory recall, no conversation persistence.
  - Append a signed `llm.call` event to `opts.chain` (an `AuditChain` instance)
    with `{provider, model, input_tokens, output_tokens, cost_estimate_usd,
    request_hash, response_hash, ts}`. `cost_estimate_usd` uses the existing
    `MODEL_PRICING` table (Anthropic models priced, OpenAI returns `null` until
    that table is expanded).
  - Default `opts.redact === true` strips raw prompt/response text from the
    hash inputs so the audit log carries structural fingerprints only — safe
    for compliance contexts that forbid PII persistence.
  - `opts.chain` omitted ⇒ silent no-op. Audit-append exceptions are caught and
    logged via `console.warn`, never propagated to the LLM caller.
  - Use cases: chat widgets / regulated-enterprise pipelines where the operator
    has manually tuned the system prompt and ANY mutation is a violation, but
    Article-12 telemetry is still required (CA Delete Act / EU AI Act surfaces).

### Changed

- **Vitest include glob widened** to `["**/*.test.ts", "**/*.spec.ts"]` so the
  pre-existing `src/swarm/swarm.spec.ts` (14 tests) is picked up by the default
  `npm test` run. No tests were lost prior — the swarm tests were running via
  ad-hoc invocations.

## [1.10.0-alpha.0] — 2026-05-18

### Added

- **Swarm primitive (`@mnemopay/sdk/swarm`)** — the missing piece browse.sh /
  Browserbase shipped as a "public skill catalog + fleet of headless browsers."
  Ours sits on top of that and adds the trust + audit + per-skill billing layer
  they don't ship. New exports:
  - `Swarm` class with `spawn(tasks) → SwarmRun`, `gather(run) → TaskResult[]`,
    `recombine(results, strategy)`, and `stop(run, reason)`.
  - `FiscalGate.precheck(budgetUsd, requestedUsd)` — static budget gate, mirrors
    the per-session shape from `@mnemopay/browser` so the SDK has no runtime dep
    on the browser package.
  - Four built-in recombine strategies — `first-success`, `majority-vote`,
    `merge-json`, `concat` — all deterministic. Plus an arbitrary callback
    `(results) => unknown` for custom recombination.
  - Audit-chain integration: every completed task appends a `swarm.task` event;
    `stop()` appends `swarm.stop`. Both are best-effort — audit chain failures
    never crash the swarm.
  - Per-task FiscalGate precheck BEFORE any session opens. Tasks above the
    per-agent budget are stamped `budget-denied` and never touch the provider.
  - Total-budget envelope across the whole run — exceeding mid-run triggers a
    graceful `stop()` against every in-flight task.
- **Supertonic voice scaffold (`@mnemopay/sdk/swarm/voice`)** — optional
  per-task narration. When `SUPERTONIC_BIN` is set and the binary is on PATH,
  `annotateResult(result)` shells out, captures the transcript, and writes it
  back to `TaskResult.voice`. Silent no-op when not configured. Lazy-loaded
  via `await import("./voice.js")` so the swarm pays zero startup cost when
  voice isn't wired.
- **New subpath exports** — `@mnemopay/sdk/swarm` and `@mnemopay/sdk/swarm/voice`.

### Notes

- Alpha. Public surface MAY shift before 1.10.0 final. Build with us at
  https://github.com/mnemopay/mnemopay-sdk.
- The skill catalog itself is hosted at https://mcp.mnemopay.com/skills — every
  row in v0.1 is honestly marked `verified: false, status: 'pending-partner'`
  until a real partnership is signed. No fake verified-by-Ramp claims.

## [1.9.0] — 2026-05-17

### Added

- **Failure-event webhooks** — `charge.failed`, `settle.failed`, `refund.failed`,
  and `transfer.failed` now fire from the MCP tool handlers when the underlying
  rail call throws. Payload includes the error message, error code, rail name,
  agent id, and (for `transfer.failed`) a `stage` field distinguishing
  `create_recipient` from `initiate_transfer` failures. Closes the 2026-05-12
  follow-up that left failure-side events deferred while success-side shipped.
  Errors still propagate to the caller — webhooks are fire-and-forget.

- **AP2 verifiable-credential adapter (`identity/ap2`)** — converts MnemoPay
  DID + reputation + charter into a Google AP2 / FIDO-Alliance-compatible
  signed credential. Google's Agents-Payments Protocol (now under FIDO
  Alliance) v0.2 names agent identity as an unsolved production gap; the
  MnemoPay DID + Wallet primitive closes that gap. New exports from
  `@mnemopay/sdk/identity` (and re-exported from the root):
  `toAp2Credential(input)`, `verifyAp2Credential(cred, { now?, publicKey? })`,
  types `Ap2Credential`, `Ap2CredentialSubject`, `Ap2SpendingMandate`,
  `Ap2Governance`, `ToAp2Input`, `Ap2VerifyError`, `VerifyResult`.

- **AP2 proof encoding now Multibase base58btc** — the `Ed25519Signature2020`
  `proof.proofValue` in AP2 verifiable credentials is now encoded as a
  Multibase base58btc string (`z…`) per the W3C VC Data Integrity 1.0 spec.
  Closes the "30-line follow-up" caveat in the original `identity/ap2`
  module. New pure helpers `multibaseBase58btcEncode` / `Decode` (plus
  `base58btcEncode` / `Decode`) exported from `@mnemopay/sdk/identity` —
  zero new runtime dependencies. **Wire-format change**: clients verifying
  credentials produced by SDK 1.8.x against 1.9.0 (or vice versa) will see
  `proof_invalid` because the proofValue encoding differs. Re-mint
  credentials after upgrade.

- **`remember({ returnReceipt: true })` overload** — `agent.remember()` now
  optionally returns `{ id, anchor }` (typed `RememberReceipt`) instead of
  just the memory id, so callers don't need a follow-up `getAnchor(id)`.
  Backwards-compatible: callers without `returnReceipt` still get
  `Promise<string>`. Implemented on both `MnemoPayLite` (mints real anchors
  when `enableAnchoring()` has run) and `MnemoPay` (anchor is always
  undefined — hosted server-side anchoring is a separate roadmap item).

- **Published governance latency bench results (p50/p95/p99) in README**, plus
  a CI-enforced invariant guard. The Phase-4 latency bench shipped in 1.8.2
  but its numbers lived only in stdout. They now appear as a dated table in
  README ("Governance latency (sub-second invariant)") and are protected by
  `tests/governance/latency-invariant.test.ts`, which fails if p95 for
  `policy.evaluateAction` exceeds 1 ms or `MerkleAudit.record` exceeds 5 ms.
  New `bench:governance` npm script (`vitest bench --run
  tests/bench/governance-latency.bench.ts`) gives reproducers a one-command
  entrypoint. Reproducible via `npm run bench:governance`.

## [1.8.2] — 2026-05-16

Phase 2 of the native-AI shift plus governance-latency observability and a
regression test for the root-import side-effect guard. All additive; no
breaking changes to the 1.8.1 surface.

### Added (in addition to the Phase 2 anchor adapter)

- **`tests/bench/governance-latency.bench.ts`** — vitest.bench harness for
  the governance hot paths (`policy.eval`, `MerkleAudit.append`, end-to-end
  charter-check + anchor-emit). Run with `npm run bench`. Lets the
  "sub-second governance" claim become a tested invariant.
- **`tests/no-side-effect-on-root-import.test.ts`** — spawns a subprocess,
  imports the root SDK, asserts no `[mnemopay-mcp]` stdio noise. Regression
  cover for the `require.main === module` guard at `src/mcp/server.ts`.
- **`npm run bench`** script in `package.json`.

### Added

- **`recall/anchor-adapter.ts`** — new pure module (zero I/O), exports:
  - `RecallAnchorAdapter` — interface for content-addressed receipt sinks.
    Deterministic on `content_id`; fail-soft on external-sink errors so the
    `remember()` write path never breaks.
  - `AnchorReceipt` — sink-agnostic envelope (`version`, `memory_id`,
    `content_id`, `sink_id`, `sink_receipt`, `receipted_at`).
  - `computeAnchorContentId(anchor)` — deterministic SHA-256 over the
    canonicalised anchor JSON; same id across adapters.
  - `NoopAnchorAdapter` — computes receipt, never forwards. Safe default.
  - `InMemoryAnchorAdapter` — reference implementation; tracks a Merkle
    batch and exposes `currentRoot()` / `batchHashes()` / `reset()`.
  - `GridStampAnchorAdapter` + `GridStampRemoteIdSink` — thin wrapper
    around GridStamp's `remoteid.sign + batchRoot` API. Loose-coupled
    (no `gridstamp` peer dep); caller passes any object satisfying the
    sink contract.

### Tests

- 6 new specs in `tests/anchor-adapter.test.ts`: deterministic content-id
  (1), Noop receipt shape (1), InMemory Merkle batch growth + reset (1),
  GridStamp sink forward (1), GridStamp fail-soft on sink error (1),
  GridStamp construction guard (1). All green.

## [1.8.1] — 2026-05-15

Engine-side anchor auto-wire. Closes the deferred item from 1.8.0: anchors
are now mintable from the `MnemoPayLite.remember()` write path with a
single setter call. The pure `anchorMemory()` primitive from 1.8.0 still
works for consumers that prefer manual wiring.

All additive; no breaking changes to the 1.8.0 surface.

### Added

- **`MnemoPayLite.enableAnchoring(wallet, opts?)`** — opt-in setter that
  enables DID-signed anchor minting on subsequent `remember()` calls.
  Defaults to auto-mode (every memory gets an anchor); pass `{auto: false}`
  to require per-call `opts.anchor === true`. Optional `ttl_ms` for anchor
  expiry and `nonceStore` for downstream verifier replay protection.
- **`MnemoPayLite.disableAnchoring()`** — flips anchoring off; subsequent
  `remember()` calls produce un-anchored memories.
- **`MnemoPayLite.getAnchor(memoryId)`** — retrieve the persisted
  `MemoryAnchor` for a stored memory.
- **`Memory.anchor?: MemoryAnchor`** — optional field on the Memory record.
  Populated when anchoring is enabled at write time. Serializes with the
  rest of the memory (survives `_saveToDisk` / `_loadFromStorage`).
- **`RememberOptions.anchor?: boolean`** — per-call opt-in/out. `true`
  force-mints; `false` force-skips even when auto-mode is on.
- **`RememberOptions.gridstamp?: GridStampSpatialProof`** — optional
  spatial-proof envelope included in the signed payload (cannot be
  swapped post-mint).

### Tests

- 7 new specs covering: anchoring-off default; auto-mint on; sequence
  monotonic increment; manual-mode opt-in; per-call force-skip;
  round-trip verifyAnchor; disableAnchoring stops minting.

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
  invocations). Confirmed in the wild by the `@blackpig/augengine` browser
  consumer. Originally shipped in `1.6.0-alpha.2`.

### Public API additions in `src/index.ts` (since 1.5.0, additive only)

- `StripeMPPRail`, `X402Rail`, `GoogleAP2Rail`, `validateMandate`
- `attachSpatialEvidence`, `verifySpatialEvidence`, `fingerprintSpatialEvidence`
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
  `@blackpig/augengine` browser consumer dogfooding `@mnemopay/sdk/recall`.

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
