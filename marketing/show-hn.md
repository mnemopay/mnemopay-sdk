# Show HN: MnemoPay – Banking infrastructure for AI agents (memory + payments + identity)

I've been building AI agents for the past year, and every project hit the same wall: the agent could think, but it couldn't remember who it served or handle real money.

So I built MnemoPay — an open-source SDK that gives any AI agent memory, a wallet, and identity in 5 lines of code.

## What it does

```ts
import MnemoPay from "@mnemopay/sdk";
const agent = MnemoPay.quick("my-agent");

await agent.remember("User prefers monthly billing");
const tx = await agent.charge(25, "Monthly API access");
await agent.settle(tx.id);
// Agent has memory, money, reputation. Ledger balanced.
```

Six integrated layers, all in one package:

1. **Cognitive memory** — Ebbinghaus forgetting curve for natural decay, Hebbian reinforcement for memories that matter. Not a key-value store.

2. **Double-entry ledger** — Luca Pacioli's 1494 system. Every debit has a credit. Always balances to zero. Stress-tested with 1,000 random transactions — fee + net = gross every time.

3. **Escrow payments** — charge → hold → settle → refund. Same flow as Stripe/Square but built for agent-to-agent transactions.

4. **Identity (KYA)** — Know Your Agent compliance. Cryptographic keypairs, capability tokens, scoped permissions, spend limits, kill switch.

5. **Fraud detection** — Velocity checks, anomaly scoring, geo-enhanced risk assessment with trust dampening. OFAC sanctions hard-block. The key design constraint: signals inform risk but never block legitimate agents on geo alone.

6. **Multi-agent commerce** — `net.transact(buyer, seller, amount, reason)` — one call, both agents remember the deal.

## Technical decisions I'm proud of

**The ledger was the hardest part.** Float precision in JavaScript is a nightmare for financial math. We use `Math.round(amount * 100) / 100` everywhere and stress-test with 1,000 random transactions. The sum of fee + net always equals gross. Zero penny drift.

**Memory that decays naturally.** Most "memory" systems are just databases. MnemoPay uses Ebbinghaus curves — memories weaken over time unless reinforced by use. Successful transactions strengthen associated memories (Hebbian reinforcement). This means the agent naturally remembers important customers and forgets one-off interactions.

**Geo fraud that doesn't block legitimate agents.** We spent a lot of time on this. Country switches, rapid hops, currency mismatches — these are all fraud signals, but they're also normal behavior for a multi-region agent. Our solution: trust dampening. An agent that consistently transacts from the same country builds a trust score (0-1). High trust dampens signal weights by up to 50%. Only OFAC-sanctioned countries trigger a hard block.

**Pluggable payment rails.** The SDK defines a `PaymentRail` interface. We ship three implementations: Paystack (Africa — NGN, GHS, ZAR, KES), Stripe (global), and Lightning (BTC). Same agent API regardless of which rail you use.

## The numbers

- 402 tests across 10 test files
- 5,000+ transactions/second (in-memory)
- 37,000+ fraud checks/second (0.03ms per check)
- 10,000 ledger entries verified in 16ms
- Volume-tiered fees: 1.9% / 1.5% / 1.0%

## Why I built this

The competitive landscape is interesting: Mem0 raised $24M but only does memory. Skyfire raised $9.5M but only does payments. Kite raised $33M — payments and identity. Six companies, $87M+ combined funding, and none of them built all six layers.

I think the agent economy needs its own credit bureau. Memory IS the credit file. If you combine persistent memory with payment history, you get something like a FICO score for AI agents. That's where this is going.

## Try it

```bash
npm install @mnemopay/sdk
```

It's MIT licensed. The SDK is free (1.9% platform fee on settled transactions). Works as an MCP server too:

```bash
claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk
```

GitHub: https://github.com/mnemopay/mnemopay-sdk
Landing page: https://getbizsuite.com/mnemopay
npm: https://npmjs.com/package/@mnemopay/sdk

Happy to answer questions about the architecture, the math, or the neuroscience behind the memory system.
