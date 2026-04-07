# MnemoPay

**Give your AI agents real superpowers.** Memory + Payments + Identity in one SDK.

Your agent remembers every interaction, handles real money, builds reputation, and trades with other agents — all with a balanced double-entry ledger that never drifts by a penny.

```bash
npm install @mnemopay/sdk
```

```ts
import MnemoPay from "@mnemopay/sdk";

const agent = MnemoPay.quick("my-agent");

await agent.remember("User prefers monthly billing");
const tx = await agent.charge(25, "Monthly API access");
await agent.settle(tx.id);
// Agent now has memory, money, and reputation. Ledger balanced.
```

330+ tests. Production-hardened. MIT licensed.

---

## Why MnemoPay

AI agents can think. They can't remember or pay. MnemoPay fixes both.

| Problem | Without MnemoPay | With MnemoPay |
|---|---|---|
| Memory | Every session starts cold | Agent remembers everything — decays naturally, strengthens on use |
| Payments | Manual API calls, no escrow | Charge → escrow → settle → refund. Real money, real rails |
| Identity | No agent verification | KYA (Know Your Agent) with capability tokens and permissions |
| Trust | No reputation system | Agent FICO score that grows with successful transactions |
| Accounting | Hope the numbers are right | Double-entry ledger. Every debit has a credit. Always balances to zero |
| Fraud | Build your own | Velocity checks, anomaly detection, geo-enhanced risk scoring |
| Multi-agent | Not possible | `net.transact("buyer", "seller", 25, "API access")` — both agents remember |

---

## Features

### Memory (Neuroscience-backed)
- **Ebbinghaus forgetting curve** — memories decay over time, just like the brain
- **Hebbian reinforcement** — successful transactions strengthen associated memories
- **Consolidation** — auto-prunes weak memories, keeps what matters
- **Semantic recall** — find memories by relevance, not just recency
- **100KB per memory** — store rich context, not just strings

### Payments (Bank-grade math)
- **Double-entry bookkeeping** — Luca Pacioli's 1494 system, 330+ tests proving it works
- **Escrow flow** — charge → hold → settle → refund (same as Stripe/Square)
- **Platform fee** — 1.9% on settlement (configurable, volume-tiered: 1.9% → 1.5% → 1.0%)
- **3 payment rails** — Paystack (Africa), Stripe (global), Lightning (BTC)
- **Penny-precise** — stress-tested with 1,000 random transactions, fee + net = gross every time

### Identity (KYA Compliance)
- **Agent identity** — cryptographic keypairs, owner verification
- **Capability tokens** — scoped permissions (charge, settle, refund, remember)
- **Spend limits** — max per transaction, max total spend, counterparty whitelists
- **Kill switch** — revoke all tokens instantly

### Fraud Detection (Geo-enhanced)
- **Velocity checks** — per-minute, per-hour, per-day limits
- **Anomaly detection** — z-score + optional ML (Isolation Forest)
- **Geo-enhanced** — country tracking, rapid-hop detection, currency mismatch, timezone anomalies
- **Geo trust** — consistent location builds trust, dampens false positives
- **OFAC sanctions** — hard blocks for sanctioned countries (KP, IR, SY, CU, RU)
- **Behavioral fingerprinting** — detects drift from agent's normal patterns

### Multi-Agent Commerce
- **MnemoPayNetwork** — register agents, execute deals, shared memory context
- **One method** — `net.transact(buyer, seller, amount, reason)` handles everything
- **Both remember** — buyer and seller each store the deal in their memory
- **Supply chains** — 10-step agent chains, 100-agent marketplaces, all tested

---

## Payment Rails

MnemoPay supports real money movement through pluggable payment rails:

```ts
import { PaystackRail, StripeRail, LightningRail } from "@mnemopay/sdk";

// Africa (NGN, GHS, ZAR, KES)
const paystack = new PaystackRail(process.env.PAYSTACK_SECRET_KEY!);

// Global (USD, EUR, GBP — cards)
const stripe = new StripeRail(process.env.STRIPE_SECRET_KEY!);

// Crypto (BTC via Lightning Network)
const lightning = new LightningRail(LND_URL, MACAROON);

// Plug into any agent
const agent = MnemoPay.quick("my-agent", { paymentRail: paystack });
```

### Paystack Rail (Built for Africa)
- Initialize → checkout → verify flow
- Charge saved cards (authorization codes)
- Bank transfers / payouts
- Webhook HMAC-SHA512 verification
- Bank account resolution
- 23 Nigerian banks pre-mapped

### Fee Structure

| Tier | Monthly Volume | Platform Fee |
|---|---|---|
| Standard | < $10,000 | 1.9% |
| Growth | $10,000 - $100,000 | 1.5% |
| Scale | $100,000+ | 1.0% |

Fees are automatically tiered based on cumulative settled volume per agent.

---

## MCP Server

MnemoPay runs as an MCP server, giving Claude and other AI assistants direct access:

```bash
npx @mnemopay/sdk init
# or
claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk
```

Available tools: `charge`, `settle`, `refund`, `remember`, `recall`, `balance`, `history`, `profile`, `reputation`, `fraud_stats`, `dispute`, `reinforce`, `consolidate`, `forget`, `logs`.

---

## Middleware

Drop MnemoPay into your existing AI stack:

```ts
// OpenAI
import { mnemoPayMiddleware } from "@mnemopay/sdk/middleware/openai";

// Anthropic
import { mnemoPayMiddleware } from "@mnemopay/sdk/middleware/anthropic";

// LangGraph
import { mnemoPayTools } from "@mnemopay/sdk/langgraph";
```

---

## Multi-Agent Example

```ts
import { MnemoPayNetwork } from "@mnemopay/sdk";

const net = new MnemoPayNetwork({ fraud: { platformFeeRate: 0.019 } });

// Register agents
net.register("buyer-bot", "owner-1", "dev@company.com");
net.register("seller-bot", "owner-2", "dev@company.com");

// Execute a deal — both agents remember, seller gets paid, ledger balances
const deal = await net.transact("buyer-bot", "seller-bot", 25, "API access for 1 month");

console.log(deal.netAmount);     // 24.52 (after 1.9% fee)
console.log(deal.platformFee);   // 0.48
console.log(deal.buyerMemoryId); // buyer remembers the purchase
console.log(deal.sellerMemoryId);// seller remembers the sale
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  MnemoPay SDK                   │
├──────────┬──────────┬───────────┬───────────────┤
│  Memory  │ Payments │ Identity  │ Fraud Guard   │
│          │          │           │               │
│ remember │ charge   │ KYA       │ velocity      │
│ recall   │ settle   │ tokens    │ anomaly       │
│ reinforce│ refund   │ perms     │ geo-enhanced  │
│ forget   │ dispute  │ killswitch│ ML (optional) │
├──────────┴──────────┴───────────┴───────────────┤
│              Double-Entry Ledger                │
│         debit + credit = always zero            │
├─────────────────────────────────────────────────┤
│              Payment Rails                      │
│     Paystack  │   Stripe   │   Lightning        │
└─────────────────────────────────────────────────┘
```

---

## Persistence

```ts
// File-based (default)
const agent = MnemoPay.quick("my-agent", { persistDir: "./data" });

// SQLite (production)
import { SQLiteStorage } from "@mnemopay/sdk/storage";
const storage = new SQLiteStorage("./mnemopay.db");

// Everything persists: memories, transactions, identity, fraud state, geo profiles
```

---

## API Reference

### Core Methods

| Method | Description |
|---|---|
| `agent.remember(content, opts?)` | Store a memory with importance scoring |
| `agent.recall(limit?, query?)` | Retrieve memories by relevance |
| `agent.charge(amount, reason)` | Create an escrow hold |
| `agent.settle(txId, counterpartyId?)` | Release escrow, apply fee, complete payment |
| `agent.refund(txId)` | Reverse a completed or pending transaction |
| `agent.dispute(txId, reason)` | File a dispute against a settled transaction |
| `agent.balance()` | Get wallet balance and reputation |
| `agent.verifyLedger()` | Confirm double-entry ledger balances to zero |
| `agent.history(limit?)` | Get transaction history |
| `agent.consolidate()` | Prune stale memories |

### Network Methods

| Method | Description |
|---|---|
| `net.register(agentId, ownerId, email)` | Register an agent on the network |
| `net.transact(buyer, seller, amount, reason)` | Full deal: charge → settle → memory → identity |
| `net.refundDeal(dealId)` | Reverse a deal, both agents remember the refund |
| `net.stats()` | Network-wide statistics |
| `net.dealsBetween(agentA, agentB)` | Get deal history between two agents |

---

## Testing

```bash
npm test          # Run all 330+ tests
npm run lint      # Type check
```

Test coverage:
- `core.test.ts` — 67 tests (memory, payments, lifecycle)
- `fraud.test.ts` — 43 tests (velocity, anomaly, fees, disputes)
- `geo-fraud.test.ts` — 20 tests (geo signals, trust, sanctions)
- `identity.test.ts` — 44 tests (KYA, tokens, permissions)
- `ledger.test.ts` — 21 tests (double-entry, reconciliation)
- `network.test.ts` — 22 tests (multi-agent, deals, supply chains)
- `paystack.test.ts` — 46 tests (rail, webhooks, transfers)
- `stress.test.ts` — 32 tests (1000-cycle precision, parallel ops)
- `recall.test.ts` — 35 tests (semantic search, decay, reinforcement)

---

## License

MIT

---

Built by [Jerry Omiagbo](https://github.com/mnemopay)
