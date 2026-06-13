# MnemoPay

[![npm version](https://img.shields.io/npm/v/@mnemopay/sdk.svg)](https://www.npmjs.com/package/@mnemopay/sdk) [![PyPI version](https://img.shields.io/pypi/v/mnemopay.svg)](https://pypi.org/project/mnemopay/) [![smithery badge](https://smithery.ai/badge/@mnemopay/sdk)](https://smithery.ai/server/@mnemopay/sdk) [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**The governance layer for AI agents that handle money.** Charter-driven mission scope, FiscalGate budget enforcement, EU AI Act Article 12 audit bundles, Agent Reputation Scoring (300-850), and a tamper-evident MerkleAudit chain — across every payment rail an agent will ever touch.

MnemoPay sits **above** the rail (Stripe, Paystack, Lightning, Stripe MPP, x402, Google AP2) and **below** the agent runtime (LangChain, CrewAI, Claude Agent SDK, your own loop). The rail moves money. The runtime decides. MnemoPay declares the rules, enforces the budget, and produces the evidence.

```bash
npm install @mnemopay/sdk
```

> **New here?** Start at [`docs/QUICKSTART.md`](./docs/QUICKSTART.md) — 60 seconds, three steps, working code.
>
> **Docs:** [Quickstart](./docs/QUICKSTART.md) · [Architecture](./docs/architecture.md) · [Permissions](./docs/permissions.md) · [Action ledger](./docs/action-ledger.md) · [Integrations (OpenAI/Anthropic/LangGraph/AutoGen)](./docs/INTEGRATIONS.md) · [Recall](./docs/RECALL.md) · [FiscalGate](./docs/FISCALGATE.md) · [Audit bundles (EU AI Act Art. 12)](./docs/AUDIT-BUNDLES.md) · [Subpath import rule](./docs/SUBPATH-IMPORT-RULE.md) · [Claude Agent SDK guide](./docs/agent-sdk-guide.md) · [Bundlers: Vite](./docs/INTEGRATION-VITE.md) · [Webpack](./docs/INTEGRATION-WEBPACK.md) · [Bun](./docs/INTEGRATION-BUN.md)
>
> **Community:** [LICENSE (Apache 2.0)](./LICENSE) · [CHANGELOG](./CHANGELOG.md) · [CONTRIBUTING](./CONTRIBUTING.md) · [CODE_OF_CONDUCT](./CODE_OF_CONDUCT.md) · [SECURITY](./SECURITY.md) · [Discussions](https://github.com/mnemopay/mnemopay-sdk/discussions) · [Good first issues](https://github.com/mnemopay/mnemopay-sdk/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22)
>
> **Receipts:** [Trust hub](https://mnemopay.com/trust) (entity, KYB, Apple Team ID, Article 12 audit chain — verify in <5 min) · [Benchmarks](./BENCHMARKS.md) (1M ops, 100% adversarial detection, $0 ledger drift) · [Python SDK on PyPI](https://pypi.org/project/mnemopay/) (full TS-rail parity since 1.1.0)

```ts
import MnemoPay, {
  Charter, FiscalGate, MerkleAudit,        // governance primitives
  AgentReputationScoring, BehavioralEngine, // trust + reputation
  StripeRail, X402Rail, GoogleAP2Rail,      // rails
} from "@mnemopay/sdk";

const agent = MnemoPay.quick("my-agent");

await agent.remember("User prefers monthly billing");
const tx = await agent.charge(25, "Monthly API access");   // FiscalGate hold
await agent.settle(tx.id);                                  // FiscalGate capture

// Agent Reputation Score — portable, 300-850 range. NOT FICO-brand, NOT a consumer
// credit report, NOT governed by FCRA. Scores agents (software), not humans.
const scorer = new AgentReputationScoring();
const result = scorer.compute({ transactions: [tx], createdAt: new Date(), /* ... */ });
// → { score: 672, rating: "good", feeRate: 0.015, trustLevel: "standard" }
```

14 modules. Hash-chained ledger. Charter / FiscalGate / Article 12 audit bundles. 6 payment rails. 200K-operation stress tested. Apache 2.0.

> **What MnemoPay is NOT:** not a bank, not a money transmitter, not a Stripe replacement, not an agent framework, not a compliance platform. It's the rules-and-evidence layer between the rail and the runtime.

---

## Governance latency (sub-second invariant)

"Sub-second governance" is a tested invariant, not marketing. The bench in `tests/bench/governance-latency.bench.ts` measures each governance hot path with `vitest bench` and emits a grep-able `[gov-bench]` summary line per scenario. Numbers below are steady-state percentiles from `npm run bench:governance` (run on the dev machine — your hardware will differ; the relative ordering is what matters).

| Hot path                                                      |  p50    |  p95    |  p99    | machine                                              |
|---------------------------------------------------------------|--------:|--------:|--------:|------------------------------------------------------|
| `policy.evaluateAction` (EU AI Act, single tool_call)         |  2.1 µs |  2.8 µs |  5.0 µs | Intel i5-1035G1 @ 1.0 GHz · Node 25.9 · Windows 11   |
| `MerkleAudit.record` (append + chain hash)                    | 20 µs   | 45 µs   | 150 µs  | Intel i5-1035G1 @ 1.0 GHz · Node 25.9 · Windows 11   |
| `MnemoPayLite.remember()` end-to-end with auto-anchor (Ed25519)| 1.0 ms  | 1.7 ms  | 2.5 ms  | Intel i5-1035G1 @ 1.0 GHz · Node 25.9 · Windows 11   |

Both per-event hot paths (`evaluateAction`, `MerkleAudit.record`) clear an entire EU AI Act policy gate and audit-chain write **two orders of magnitude inside one millisecond**. The end-to-end `remember()` path — including Ed25519 sign + sequence + chain emit — still sits comfortably inside the "sub-second governance" envelope with three decimal-orders of headroom.

A CI-enforced guard spec in `tests/governance/latency-invariant.test.ts` runs a degraded-mode sample on every `npm test` and fails if p95 for `policy.evaluateAction` regresses past 1 ms, or `MerkleAudit.record` past 5 ms. Bounds are sized to catch a ~10x regression, not flap on jitter.

**How to reproduce:** `npm run bench:governance` (full vitest.bench harness) or `npm test -- latency-invariant` (CI-bound check).

---

## Native rails

Every rail ships with the same `PaymentRail` interface as `StripeRail` / `PaystackRail` / `LightningRail`:

| Rail | What it is |
|---|---|
| **`StripeMPPRail`** | Stripe Machine Payments Protocol — agent payments routed as crypto deposits on the Tempo network via Stripe-pinned API `2026-03-04.preview` |
| **`X402Rail`** | Coinbase x402 (HTTP 402 revival) — USDC on Base L2 via EIP-3009 `transferWithAuthorization`. Pluggable signer (bring-your-own viem/ethers/noble). Zero crypto deps in the SDK. |
| **`GoogleAP2Rail`** | Google Agent Payment Protocol (FIDO Alliance, AP2 v0.2). Mandate VC + Intent VC + HTTP settlement. Pre-flight policy enforcement (caps, expiry, currency, recipients) before any signature is produced. |

Plus the **Spatial governance fold** — `attachSpatialEvidence()` co-signs the MerkleAudit chain with GridStamp proof-of-presence for embodied agents (drones, robots). Loose-coupled — no `gridstamp` runtime dependency.

### Subpath imports for smaller, safer consumers

If you only need one MnemoPay module, import that subpath instead of the package root. This keeps MCP servers and other stdio tools quiet, avoids pulling unused middleware into bundles, and makes the dependency boundary obvious.

```ts
import { localEmbed, cosineSimilarity } from "@mnemopay/sdk/recall";
import { StripeRail, X402Rail } from "@mnemopay/sdk/rails";
import { SQLiteStorage } from "@mnemopay/sdk/storage";
import { CommerceEngine } from "@mnemopay/sdk/commerce";
```

Use the root import when you want the full SDK surface. Use `@mnemopay/sdk/mcp` only when you are intentionally mounting the MnemoPay MCP server.

---

## Swarm (alpha — build with us)

`@mnemopay/sdk/swarm` is the missing piece that browse.sh shipped as a public skill catalog. Ours adds the bit they don't: every agent in the swarm carries a DID, every action is FiscalGate-prechecked against per-agent + total caps, every TaskResult is appended to a shared Article-12 audit chain, and every skill invocation is billable through the same hash-chained ledger the rest of the SDK already uses.

```ts
import { Swarm } from "@mnemopay/sdk/swarm";
import { AuditChain } from "@mnemopay/sdk/governance";
import { open } from "@mnemopay/browser";   // any BrowserProvider works

const provider = await someProviderFactory();
const swarm = new Swarm({
  size: 4,
  provider,
  did: "did:mp:abc...",
  budget: { perAgent: 0.25, total: 1.00 },
  audit: { chain: new AuditChain() },
});

const run = await swarm.spawn([
  { id: "t1", skillId: "ramp.com/expense-create",  prompt: "submit $42 lunch" },
  { id: "t2", skillId: "linear/issue-create",      prompt: "file UI bug" },
  { id: "t3", skillId: "cloudflare/dns-record-set", prompt: "add CNAME" },
]);

const results = await swarm.gather(run);
const final   = await swarm.recombine(results, "merge-json");
```

**When to use it.** Any time you'd open N parallel browser sessions to attack a problem — multi-source research, cross-platform issue triage, A/B-style "ask three agents, take the majority answer" — but you want one audit bundle, one budget envelope, and one place where billing happens.

**Three recombine strategies (plus your own).**
- `first-success` — returns the output of the first `ok:true` task; perfect for race patterns where any answer is fine.
- `majority-vote` — returns the most-common output across `ok:true` tasks; perfect for fact-extraction where consensus matters.
- `merge-json` — deep-merges every `ok:true` object output with sorted keys (deterministic across runs).
- `concat` — joins string outputs with `\n` in spawn order.
- Or pass any `(results) => unknown` callback.

**Skill catalog.** Public listings live at [mcp.mnemopay.com/skills](https://mcp.mnemopay.com/skills). The catalog is intentionally small and honestly marked — verified-partner badges only show after a real partnership is signed. Everything else carries `verified: false, status: 'pending-partner'` so you know exactly what trust tier you're getting.

### BrowserSwarm — native browser-session fan-out (1.11.0-alpha.0)

`@mnemopay/sdk/swarm/browser` extends `Swarm` with a typed step sequence (`goto` / `act` / `extract` / `screenshot` / `wait`) per task and a lazy wire to `@mnemopay/browser` (optional peer dep — installing the SDK does NOT pull Playwright). Each task gets its own browser session, every step appends a `browser.step` event to the shared audit chain, and a thrown step kills only that one task — sibling sessions keep running. Alpha; build with us.

```ts
import { BrowserSwarm } from "@mnemopay/sdk/swarm/browser";
const swarm = new BrowserSwarm({
  size: 3, provider: undefined as never,
  budget: { perAgent: 0.25, total: 1.00 },
  browser: { provider: "stagehand" },
});
const run = await swarm.spawn([
  { id: "amzn", prompt: "amazon price",  steps: [{type:"goto", url:"https://amazon.com/dp/X"},  {type:"extract", selector:"#priceblock_ourprice"}] },
  { id: "bby",  prompt: "best buy price", steps: [{type:"goto", url:"https://bestbuy.com/site/X"},{type:"extract", selector:".priceView-customer-price"}] },
  { id: "tgt",  prompt: "target price",   steps: [{type:"goto", url:"https://target.com/p/X"},   {type:"extract", selector:"[data-test=product-price]"}] },
]);
const results = await swarm.gather(run);   // BrowserTaskResult[] with .screenshots + .extractedData
```

Alpha — public API may shift before 1.11.0 final. File issues at [github.com/mnemopay/mnemopay-sdk](https://github.com/mnemopay/mnemopay-sdk).

### Audit-only middleware — `.audit(client)` with streaming + on-disk chain (1.11.0-alpha.0)

For chat widgets and regulated pipelines where ANY prompt mutation is a violation but Article-12 telemetry is still required:

```ts
import { AuditChain } from "@mnemopay/sdk/governance/audit-chain";
import { AnthropicMiddleware } from "@mnemopay/sdk/middleware/anthropic-audit";

const chain = new AuditChain({ path: "./.audit-chain/llm.jsonl" });  // file-backed since 1.11.0-alpha.0
const client = AnthropicMiddleware.audit(new Anthropic(), { chain });

// .create AND .stream now both emit one `llm.call` event per call. Streams
// that get cancelled mid-iteration emit `partial: true` with tokens-so-far.
for await (const chunk of client.messages.stream({ model, max_tokens, messages })) { /* ... */ }
```

`@mnemopay/sdk/middleware/openai-audit` exposes the equivalent shape for OpenAI — `chat.completions.create({ stream: true })` is intercepted automatically (pass `stream_options: { include_usage: true }` to capture the final usage block).

---

## Building an MCP server? Start here.

If you're shipping an MCP server and want to charge per-call — even sub-cent amounts — MnemoPay is built for you.

- **Sub-cent payments** via Lightning rail (impossible on Stripe/Paystack due to fees)
- **Per-tool metering** with `agent.charge(amount, toolName)` — two lines of code
- **Agent Reputation Scoring** gates abusive callers automatically — 300-850 reputation score, free tier + paid tier
- **Cryptographic receipts** every user can audit — no "trust me bro" billing
- **Free indefinitely** for the first 10 MCP servers that adopt it, subject to 90 days' written notice of any future change ([email](mailto:omiagbogold@icloud.com) with your repo)

```ts
import MnemoPay from "@mnemopay/sdk";
const agent = MnemoPay.quick("my-mcp-server");

// Inside your tool handler:
const tx = await agent.charge(0.002, "embed_document");  // 0.2¢
if (tx.status === "blocked") return { error: "Payment declined" };
await agent.settle(tx.id);
// ... run the tool
```

Zero-config starter → production Lightning rail → Agent Reputation Scoring gating. Same API.

---

## What Makes MnemoPay Different

$87M has been invested across 5 competitors. None have more than 3 of these 10 features:

| Feature | MnemoPay | Mem0 ($24M) | Skyfire ($9.5M) | Kite ($33M) | Payman ($14M) |
|---|:---:|:---:|:---:|:---:|:---:|
| Persistent Memory | **Yes** | Yes | No | No | No |
| Payment Rails (3) | **Yes** | No | USDC only | Stablecoin | Bank only |
| Agent Identity (KYA) | **Yes** | No | Building | Passport | No |
| **Agent Reputation Scoring (300-850)** | **Yes** | No | No | No | No |
| **Behavioral Finance** | **Yes** | No | No | No | No |
| **Memory Integrity (Merkle)** | **Yes** | No | No | No | No |
| **EWMA Anomaly Detection** | **Yes** | No | No | No | No |
| Double-Entry Ledger | **Yes** | No | No | No | No |
| Autonomous Commerce | **Yes** | No | No | No | No |
| Multi-Agent Network | **Yes** | No | Partial | Partial | No |
| **Score** | **10/10** | 1/10 | 2/10 | 2/10 | 1/10 |

---

## Agent Reputation Scoring

A novel cross-session reputation scoring system for AI agents. Five-component scoring on a 300-850 range (familiar to developers from consumer credit; MnemoPay is not affiliated with Fair Isaac Corporation or any consumer credit bureau):

```ts
import { AgentReputationScoring } from "@mnemopay/sdk";

const scorer = new AgentReputationScoring();
const result = scorer.compute({
  transactions: await agent.history(1000),
  createdAt: agentCreationDate,
  fraudFlags: 0,
  disputeCount: 0,
  disputesLost: 0,
  warnings: 0,
  budgetCap: 5000,
  memoriesCount: agent.memories.size,
});

console.log(result.score);      // 742
console.log(result.rating);     // "very_good"
console.log(result.feeRate);    // 0.013 (1.3%)
console.log(result.trustLevel); // "high"
console.log(result.requiresHITL); // false
```

| Component | Weight | What It Measures |
|---|---|---|
| Payment History | 35% | Success rate, disputes, recency-weighted |
| Credit Utilization | 20% | Spend vs budget cap, sweet spot 10-30% |
| History Length | 15% | Account age, activity density |
| Behavior Diversity | 15% | Counterparties, categories, amount range |
| Fraud Record | 15% | Fraud flags, disputes lost, warnings |

| Score Range | Rating | Trust Level | Fee Rate |
|---|---|---|---|
| 800-850 | Exceptional | Full trust | 1.0% |
| 740-799 | Very Good | High trust | 1.3% |
| 670-739 | Good | Standard | 1.5% |
| 580-669 | Fair | Reduced | 1.9% |
| 300-579 | Poor | Minimal + HITL | 2.5% |

---

## Behavioral Finance Engine

Peer-reviewed behavioral economics from Nobel laureate Daniel Kahneman and collaborators. Every parameter cited to published research.

```ts
import { BehavioralEngine } from "@mnemopay/sdk";

const behavioral = new BehavioralEngine();

// Prospect Theory (Kahneman & Tversky, 1992)
// Losses hurt 2.25x more than gains feel good
behavioral.prospectValue(100);   // { value: 57.5, domain: "gain" }
behavioral.prospectValue(-100);  // { value: -129.5, domain: "loss" }

// Should the agent wait before buying?
const cooling = behavioral.coolingOff(2000, 5000); // amount, monthly income
// → { recommended: true, hours: 3.2, riskLevel: "high", regretProbability: 0.65 }

// Frame spending as goal delay (2.25x more effective than gain framing)
const frame = behavioral.lossFrame(200, {
  name: "Emergency Fund", target: 10000, current: 3000, monthlySavings: 500
});
// → "This $200 purchase delays your Emergency Fund goal by 12 days."

// Save More Tomorrow (Thaler & Benartzi, 2004)
const smart = behavioral.commitmentDevice(0.035, 0.03, 4);
// → { finalRate: 0.095, explanation: "3.5% → 9.5% over 4 raise cycles" }

// Predict regret from purchase history
behavioral.recordRegret({ amount: 300, category: "gadgets", regretScore: 8, timestamp: "..." });
const prediction = behavioral.predictRegret(400, "gadgets");
// → { probability: 0.72, triggerCoolingOff: true }
```

**Research sources:** Tversky & Kahneman 1992, Laibson 1997, Thaler & Benartzi 2004, Barber & Odean 2000, Nunes & Dreze 2006, Shiller 2000.

---

## Memory Integrity (Merkle Tree)

Tamper-evident memory. If anyone injects, modifies, or deletes an agent's memories, the Merkle root changes and you know.

```ts
import { MerkleTree } from "@mnemopay/sdk";

const tree = new MerkleTree();

// Every memory write adds a leaf
tree.addLeaf("mem-1", "User prefers monthly billing");
tree.addLeaf("mem-2", "Last purchase was $25 API access");

// Take periodic snapshots
const snapshot = tree.snapshot();
// → { rootHash: "a3f2...", leafCount: 2, snapshotHash: "b7c1..." }

// Later: check if memories were tampered
const check = tree.detectTampering(snapshot);
// → { tampered: false, summary: "Integrity verified. 2 memories, root matches." }

// Prove a specific memory exists without revealing others
const proof = tree.getProof("mem-1");
MerkleTree.verifyProof(proof); // true
```

**Defends against:** MemoryGraft injection, silent deletion, content tampering, replay attacks, reordering attacks.

---

## Anomaly Detection (EWMA + Behavioral Fingerprinting + Canaries)

Three independent systems that catch compromised agents.

```ts
import { EWMADetector, BehaviorMonitor, CanarySystem } from "@mnemopay/sdk";

// 1. EWMA: real-time streaming anomaly detection
const detector = new EWMADetector(0.15, 2.5, 3.5, 10);
detector.update(100); // normal
detector.update(100); // normal
detector.update(9999); // → { anomaly: true, severity: "critical", zScore: 8.2 }

// 2. Behavioral fingerprinting: detect hijacked agents
const monitor = new BehaviorMonitor({ warmupPeriod: 10 });
// Build profile over time
monitor.observe("agent-1", { amount: 100, hourOfDay: 14, chargesPerHour: 2 });
// Sudden change = suspected hijack
monitor.observe("agent-1", { amount: 9999, hourOfDay: 3, chargesPerHour: 50 });
// → { suspected: true, severity: "critical", anomalousFeatures: 3 }

// 3. Canary honeypots: plant traps for compromised agents
const canary = new CanarySystem();
const trap = canary.plant("transaction");
canary.check(trap.id, "rogue-agent");
// → { severity: "critical", message: "CANARY TRIGGERED: Agent compromised" }
```

**Math:** `mu_t = alpha * x_t + (1 - alpha) * mu_{t-1}`, alert when `|x_t - mu_t| > k * sigma_t` (Roberts 1959, Lucas & Saccucci 1990).

---

## Memory (Compounding Knowledge Base)

Not a traditional RAG lookup. MnemoPay memories compound — every transaction strengthens associated context, weak memories decay, strong ones consolidate. The same pattern Karpathy describes as "LLM Wiki" but applied to payments and trust.

- **Ebbinghaus forgetting curve** — memories decay naturally over time
- **Hebbian reinforcement** — successful transactions strengthen associated memories
- **RL feedback loop** — `rlFeedback(ids, reward)` applies EWMA importance updates after agent actions
- **Consolidation** — auto-prunes weak memories, keeps what matters
- **Semantic recall** — find memories by relevance, not just recency
- **100KB per memory** — store rich context, not just strings

```ts
// After a recall + action, signal usefulness with rlFeedback
const memories = await agent.recall("user preferences", 5);
// ... agent acts on recalled memories ...
await agent.rlFeedback(memories.map(m => m.id), +1.0);   // +1 = useful, -1 = not useful
```

## Reputation Streaks & Badges

Agents earn trust over time. Consecutive successful settlements build streaks that unlock badges and reduce fees.

```ts
const rep = await agent.reputation();
console.log(rep.streak);
// → { currentStreak: 47, bestStreak: 312, streakBonus: 0.094 }

console.log(rep.badges);
// → [
//   { id: "first_settlement", name: "First Settlement", earnedAt: 1712700000000 },
//   { id: "streak_50", name: "Streak Master", earnedAt: 1712900000000 },
//   { id: "volume_10k", name: "High Roller", earnedAt: 1713100000000 },
// ]
```

| Badge | Requirement |
|---|---|
| First Settlement | Complete 1 settlement |
| Streak 10 | 10 consecutive settlements |
| Streak 50 | 50 consecutive settlements |
| Volume $1K | $1,000+ total settled |
| Volume $10K | $10,000+ total settled |
| Perfect Record | 100+ settlements, 0 disputes |

Streaks reset on refunds or disputes. Streak bonuses compound reputation up to +10%.

## Hash-Chained Ledger

Every ledger entry links to the previous via SHA-256 hash chain. If any entry is modified, the chain breaks and `verify()` catches it instantly.

```ts
const summary = agent.ledger.verify();
console.log(summary.chainValid);     // true
console.log(summary.chainIntegrity); // 1.0 (100% of links verified)
```

Combined with Merkle integrity on memories and HMAC on transactions, MnemoPay gives you three independent tamper-detection systems.

## Payments (cent-precise double-entry)

- **Double-entry bookkeeping** — every debit has a credit, always balances to zero
- **Escrow flow** — charge -> hold -> settle -> refund (same shape as Stripe/Square)
- **Volume-tiered fees** — 1.9% / 1.5% / 1.0% based on cumulative volume
- **3 payment rails** — Paystack (Africa), Stripe (global), Lightning (BTC)
- **Cent-precise integer math** — stress-tested with 200,000 transactions across 50 concurrent agents, zero drift

## Identity (KYA Compliance)

- **Cryptographic identity** — HMAC-SHA256 keypairs, replay protection
- **Capability tokens** — scoped permissions with spend limits
- **Counterparty whitelists** — restrict who the agent can transact with
- **Kill switch** — revoke all tokens instantly

## Fraud Detection (ML-grade)

- **Velocity checks** — per-minute/hour/day limits
- **Isolation Forest** — unsupervised ML anomaly detection
- **Geo-enhanced** — country tracking, rapid-hop detection, OFAC sanctions
- **Adaptive engine** — asymmetric AIMD, anti-gaming, circuit breaker, PSI drift detection

## Multi-Agent Commerce

- **CommerceEngine** — autonomous shopping with mandates, escrow, approval callbacks
- **MnemoPayNetwork** — register agents, execute deals, shared memory context
- **Supply chains** — 10-step agent chains, 100-agent marketplaces, all tested

---

## Claude Agent SDK integration

Two primitives built specifically for the Claude Agent SDK pattern where an Opus orchestrator spawns Sonnet/Haiku subagents.

### 1-hour prompt cache on recall results

When you feed MnemoPay recall into a Claude system prompt, use `formatForClaudeCache()` to emit a content block with `cache_control: { type: "ephemeral", ttl: 3600 }`. The Anthropic API caches that prefix for up to 1 hour; cache reads are billed at roughly 10% of the normal input rate. With stable recall prefixes and a warm 1h cache, users have observed savings in the typical range of 85-92% on the recall portion of input tokens — your actual results depend on call frequency and memory set stability.

```ts
import MnemoPay, { formatForClaudeCache } from "@mnemopay/sdk";
import Anthropic from "@anthropic-ai/sdk";

const agent = MnemoPay.quick("my-agent");
const anthropic = new Anthropic();

// Option A: recall() directly returns a cache block
const cacheBlock = await agent.recall("user preferences", 10, {
  formatForClaudeCache: true,
});

// Option B: convert an existing memory array (no extra recall call)
const memories = await agent.recall("user preferences", 10);
const cacheBlock2 = MnemoPay.formatForClaudeCache(memories);
// OR: formatForClaudeCache(memories) from the module directly

const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 1024,
  system: [
    { type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } },
    cacheBlock,  // ← MnemoPay recall cached for 1 hour
  ],
  messages: [{ role: "user", content: userMessage }],
});
```

The serialized text is sorted by memory id so identical memory sets produce byte-identical output — required for the cache prefix to hit on subsequent turns.

### Per-subagent cost attribution

Track which subagent in a multi-agent pipeline spent how much — recorded as double-entry ledger pairs so it stays audit-clean.

```ts
import MnemoPay, { SubagentCostTracker } from "@mnemopay/sdk";

const orchestrator = MnemoPay.quick("orchestrator");

// After each Claude API call, record the cost:
orchestrator.subagentCosts.attributeSubagentCost({
  parentAgentId: "orchestrator",
  subagentId: "researcher-1",
  subagentRole: "researcher",
  modelId: "claude-sonnet-4-6",
  inputTokens: 5000,
  outputTokens: 2000,
  cacheReadTokens: 8500,   // tokens served from the 1h recall cache
  cacheWriteTokens: 500,
  cacheWriteTtl: "1h",
});

// At end of pipeline, get breakdown ordered by cost:
const breakdown = orchestrator.subagentCosts.subagentCostBreakdown("orchestrator");
// → [{ subagentId, subagentRole, modelId, totalCostUsd, cacheSavingsUsd, ... }]

const totalSaved = orchestrator.subagentCosts.totalCacheSavings("orchestrator");
```

Pricing table used: 2026 Anthropic list rates (Opus 4.7 $5/$25/M, Sonnet 4.6 $3/$15/M, Haiku 4.5 $1/$5/M; cache reads 0.1×, 1h writes 2×). Update `MODEL_PRICING` in `src/subagent-cost.ts` if rates change.

See `docs/agent-sdk-guide.md` for a full integration walkthrough.

---

## Payment Rails

Every rail implements the same `PaymentRail` interface — `createHold` / `capturePayment` / `reversePayment`. Swap rails without touching agent code.

| Rail | Coverage |
|---|---|
| `StripeRail` | Cards (USD, EUR, GBP, +) |
| `PaystackRail` | Africa (NGN, GHS, ZAR, KES) |
| `LightningRail` | BTC sub-cent micropayments |
| `StripeMPPRail` | Crypto deposits on Tempo via Stripe MPP |
| `X402Rail` | USDC on Base via EIP-3009 transferWithAuthorization |
| `GoogleAP2Rail` | AP2 v0.2 mandate-driven settlement (FIDO Alliance) |

```ts
import {
  PaystackRail, StripeRail, LightningRail,
  StripeMPPRail, X402Rail, GoogleAP2Rail,
} from "@mnemopay/sdk";

const paystack  = new PaystackRail(process.env.PAYSTACK_SECRET_KEY!);
const stripe    = new StripeRail(process.env.STRIPE_SECRET_KEY!);
const lightning = new LightningRail(LND_URL, MACAROON);

const mpp   = new StripeMPPRail(process.env.STRIPE_SECRET_KEY!);
const x402  = new X402Rail({ signer: yourEip3009Signer });   // bring-your-own crypto
const ap2   = new GoogleAP2Rail({ mandate, endpoint, signer });

const agent = MnemoPay.quick("my-agent", { paymentRail: paystack });
```

### Stripe — real card charges with saved customers

End-to-end flow for charging a user's saved card without a browser handoff:

```ts
import MnemoPay, { StripeRail } from "@mnemopay/sdk";

const rail = new StripeRail(process.env.STRIPE_SECRET_KEY!);
const agent = MnemoPay.quick("agent-1", { paymentRail: rail });

// 1. Create a Stripe customer (one-time, persist cus_... to your DB)
const { customerId } = await rail.createCustomer("user@example.com", "Jerry O");

// 2. Collect a card via Stripe.js: create a SetupIntent, return client_secret
//    to the browser, let Stripe Elements confirm it. You receive pm_... from
//    the webhook or confirmation callback. Save it alongside the customer.
const { clientSecret } = await rail.createSetupIntent(customerId);
// → hand clientSecret to frontend, get back paymentMethodId after confirm

// 3. Charge the saved card later, off-session, no user interaction needed
const tx = await agent.charge(25, "Monthly API access", undefined, {
  customerId,
  paymentMethodId: "pm_saved_from_step_2",
  offSession: true,
});

// 4. Settle (captures the hold) or refund (releases it)
await agent.settle(tx.id);
```

Paystack supports the same pattern via `authorizationCode`:

```ts
const tx = await agent.charge(5000, "NGN invoice", undefined, {
  email: "customer@example.com",
  authorizationCode: "AUTH_abc123", // from an earlier Paystack transaction
});
```

---

## MCP Server

```bash
npx @mnemopay/sdk init
# or
claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk
```

**Default tool group: `essentials` (14 tools, ~1K tokens).** One of the
lightest MCP servers you can install — MnemoPay only loads memory + wallet +
tx by default so it doesn't tax your agent's context budget.

- `memory`: `remember`, `recall`, `forget`, `reinforce`, `consolidate`
- `wallet`: `balance`, `profile`, `history`, `logs`
- `tx`: `charge`, `settle`, `refund`, `dispute`, `receipt_get`

Need more? Opt in explicitly:

```bash
npx @mnemopay/sdk --tools=all       # all 95 tools
npx @mnemopay/sdk --tools=agent     # essentials + commerce + hitl + payments + webhooks
npx @mnemopay/sdk --tools=reputation  # Agent Reputation Scoring only
```

Groups: `memory`, `wallet`, `tx`, `commerce`, `hitl`, `payments`, `webhooks`,
`reputation`, `security`, `governance`, `identity`, `skills`, `spatial`,
`agent_os`, `organization_admin`, `operator`. Aliases: `essentials` (default),
`agent`, `all`. Also settable via `MNEMOPAY_TOOLS` env var.

> **Breaking change in v1.3.0:** default was `all`, now `essentials`. If you
> relied on commerce/hitl/webhooks/fico/security being available without a
> flag, pass `--tools=all` or `--tools=agent`. See [CHANGELOG](./CHANGELOG.md).

---

## Middleware

Drop-in proxies that make recall invisible: every chat call auto-injects the
top memories as system context and stores the exchange afterward. Same
`Middleware.wrap(client, agent)` shape across every provider.

```ts
// OpenAI
import { mnemoPayMiddleware } from "@mnemopay/sdk/middleware/openai";

// Anthropic
import { mnemoPayMiddleware } from "@mnemopay/sdk/middleware/anthropic";

// Gemini
import { GeminiMiddleware } from "@mnemopay/sdk/middleware/gemini";

// Cohere (v2 chat API)
import { CohereMiddleware } from "@mnemopay/sdk/middleware/cohere";
const cohere = CohereMiddleware.wrap(new CohereClientV2({ token }), agent);

// Mistral
import { MistralMiddleware } from "@mnemopay/sdk/middleware/mistral";
const mistral = MistralMiddleware.wrap(new Mistral({ apiKey }), agent);

// LangGraph
import { mnemoPayTools } from "@mnemopay/sdk/langgraph";
```

---

## Architecture

Full stack diagram and module map: [`docs/architecture.md`](./docs/architecture.md).

```
┌──────────────────────────────────────────────────────────────────┐
│                       MnemoPay SDK                                │
│              Governance · Memory · Payments · Identity            │
├─────────────────────────────────────────────────────────────────┤
│ GOVERNANCE  Charter · FiscalGate · Article 12 · MerkleAudit      │
│             mission scope, budget enforcement, audit bundles     │
├──────────┬──────────┬───────────┬─────────────────────────────────┤
│  Memory  │ Payments │ Identity  │  Agent Reputation Scoring       │
│          │          │           │  300-850, 5-component           │
│ remember │ charge   │ KYA       ├─────────────────────────────────┤
│ recall   │ settle   │ tokens    │  Behavioral Finance             │
│ reinforce│ refund   │ perms     │  prospect theory, nudges        │
│ forget   │ dispute  │ killswitch├─────────────────────────────────┤
│          │          │           │  Anomaly Detection              │
│          │          │           │  EWMA + fingerprinting          │
├──────────┴──────────┴───────────┼─────────────────────────────────┤
│     Double-Entry Ledger         │  Merkle Integrity               │
│  debit + credit = always zero   │  tamper-evident memory          │
├─────────────────────────────────┼─────────────────────────────────┤
│     Fraud Guard (ML-grade)      │  Canary Honeypots               │
│  velocity + geo + adaptive      │  compromise detection           │
├─────────────────────────────────┴─────────────────────────────────┤
│ SPATIAL    GridStamp adapter — proof-of-presence for embodied      │
│            agents (drones, robots). Loose-coupled, fail-closed.    │
├──────────────────────────────────────────────────────────────────┤
│ RAILS  Stripe · Paystack · Lightning · StripeMPP · x402 · AP2    │
│        same PaymentRail interface — drop-in swap, no agent diff   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Module stability

MnemoPay follows semver. Stability tiers tell you how much a module's public API may shift before 2.0 — see [VERSIONING.md](VERSIONING.md) for the full contract.

| Module | Import | Stability | Notes |
|---|---|---|---|
| Memory / recall | `@mnemopay/sdk/recall` | **Stable** | remember · recall · reinforce · forget |
| Payments | `@mnemopay/sdk` | **Stable** | charge · settle · refund · dispute, cent-precise |
| Double-entry ledger | `@mnemopay/sdk` | **Stable** | debit+credit=0, hash-chained |
| Identity (KYA) | `@mnemopay/sdk/identity` | **Stable** | Ed25519, capability tokens, killswitch |
| Agent Reputation Scoring | `@mnemopay/sdk` | **Stable** | 5-component, 300–850 |
| Fraud / anomaly | `@mnemopay/sdk` | **Stable** | velocity, geo, EWMA, canaries |
| Payment rails (Stripe/Paystack/Lightning) | `@mnemopay/sdk/rails` | **Stable** | one `PaymentRail` interface |
| Governance — policy | `@mnemopay/sdk/governance/policy` | **Stable** | sub-second `evaluateAction` |
| Governance — audit chain | `@mnemopay/sdk/governance/audit-chain` | **Stable** | Merkle event stream, Article 12 export |
| Governance — charter / Article 12 | `@mnemopay/sdk/governance` | **Stable** | mission scope + EU AI Act bundles |
| Governance — approval routing | `@mnemopay/sdk/governance/approval` | **Beta** | HITL queue + `routeVerdict` |
| Governance — risk taxonomy | `@mnemopay/sdk/governance/risk` | **Beta** | Low→Critical ladder + preset policy |
| Governance — action ledger | `@mnemopay/sdk/governance/action-ledger` | **Beta** | typed "what did the agent do" record |
| MnemoSkills (governed skills) | `@mnemopay/sdk/skills` | **Beta** | versioned, permissioned, billable capabilities — see [examples/08-invoice-collector.ts](./examples/08-invoice-collector.ts) |
| Spatial / GridStamp | `@mnemopay/sdk/governance` | **Beta** | proof-of-presence, loose-coupled, fail-closed |
| Rails — x402 / AP2 / StripeMPP | `@mnemopay/sdk/rails` | **Alpha** | emerging agent-payment standards |
| Swarm (voice / browser) | `@mnemopay/sdk/swarm` | **Alpha** | public API may shift; build with us |

---

## Testing

```bash
npm test    # full test suite across 12 files
```

- `core.test.ts` — memory, payments, lifecycle, reputation scoring, behavioral, Merkle, EWMA, canaries, streaks, badges
- `fraud.test.ts` — velocity, anomaly, fees, disputes, replay detection
- `geo-fraud.test.ts` — geo signals, trust, sanctions
- `identity.test.ts` — KYA, tokens, permissions
- `production-100k.test.ts` — 100K operations, 10 concurrent agents, hash-chain verification, zero drift
- `stress-200k.test.ts` — 200K real-world stress: 50 agents, burst traffic, race conditions, refund storms, memory leak detection
- `ledger.test.ts` — double-entry, reconciliation
- `network.test.ts` — multi-agent, deals, supply chains
- `paystack.test.ts` — rail, webhooks, transfers
- `stress.test.ts` — 1000-cycle precision, parallel ops
- `recall.test.ts` — semantic search, decay, reinforcement

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2026 J&B Enterprise LLC.

---

## Third-party attributions

The entity-observation write-path in `src/recall/observations.ts` (per-entity consolidated summaries, debounced regeneration, session-spanning rollups) is derived from [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) (MIT, Copyright (c) 2025 Vectorize AI, Inc.). The full upstream notice is preserved in [NOTICE](NOTICE) and in the header of the ported file.

---

## Trademark and regulatory notices

**Agent Reputation Scoring** is a trustworthiness scoring system **for autonomous software agents**, not for consumer credit reporting. It does not produce a consumer report as defined by the Fair Credit Reporting Act (FCRA) and is not regulated under the FCRA. MnemoPay is not a consumer reporting agency.

MnemoPay is not a bank, money transmitter, or insurer, and does not hold customer deposits. Payments are settled through third-party payment rails (Stripe, Paystack, Lightning Network) — MnemoPay is software that connects to those rails on behalf of developers, not a financial institution.

"FICO" is a registered trademark of Fair Isaac Corporation. MnemoPay and its Agent Reputation Scoring module are not affiliated with, endorsed by, or derived from Fair Isaac Corporation. The `AgentCreditScore` and `AgentFICO` export names are deprecated aliases kept for backward compatibility with earlier beta releases and will be removed in a future major version.

---

Built by [Jeremiah Omiagbo](https://github.com/mnemopay)
