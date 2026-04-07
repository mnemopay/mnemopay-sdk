---
title: How to Add Memory and Payments to Your AI Agent in 5 Minutes
published: false
description: Give your AI agent a wallet, persistent memory, and fraud detection with one npm package. Step-by-step tutorial.
tags: ai, javascript, node, webdev
cover_image: https://getbizsuite.com/mnemopay/img/hero-ceo.png
---

Your AI agent can think. It can reason. It can call APIs and make decisions.

But ask it what happened in the last session and it draws a blank. Ask it to hold money in escrow and it has no idea what you mean.

I ran into this on every agent project I built. So I made an SDK that fixes both problems at once.

## Install

```bash
npm install @mnemopay/sdk
```

## Step 1: Give Your Agent Memory

```typescript
import MnemoPay from "@mnemopay/sdk";

const agent = MnemoPay.quick("my-agent");

// Store memories with importance scoring
await agent.remember("User prefers monthly billing at $25/mo", {
  importance: 0.8
});

await agent.remember("User's timezone is CST, prefers morning emails");

// Recall memories — sorted by relevance, not just recency
const memories = await agent.recall(5);
console.log(memories);
// Returns the 5 most relevant memories, weighted by
// importance, recency, and reinforcement strength
```

This isn't a key-value store. The memory system is built on two neuroscience principles:

- **Ebbinghaus forgetting curve** — memories naturally decay over time, just like human memory
- **Hebbian reinforcement** — "neurons that fire together wire together." When a memory leads to a successful transaction, it gets stronger

The result: your agent naturally remembers important customers and gradually forgets one-off interactions.

## Step 2: Give Your Agent a Wallet

```typescript
// Charge with automatic escrow
const tx = await agent.charge(25, "Monthly API access");
console.log(tx.status); // "pending" — money is in escrow

// Settle when the service is delivered
await agent.settle(tx.id, "customer-agent-42");
// Fee is applied (1.9%), net goes to the agent, ledger balanced

// Check the balance
const { wallet, reputation } = await agent.balance();
console.log(wallet);     // 24.52 (after 1.9% fee)
console.log(reputation); // 0.55 (grows with successful deals)
```

Every transaction uses double-entry bookkeeping. Every debit has a credit. The ledger always balances to zero. We stress-tested this with 1,000 random transactions — the math never drifts by a penny.

## Step 3: Multi-Agent Commerce

This is where it gets interesting. Two agents making a deal:

```typescript
import { MnemoPayNetwork } from "@mnemopay/sdk";

const net = new MnemoPayNetwork();

net.register("buyer-bot", "owner-1", "dev@company.com");
net.register("seller-bot", "owner-2", "dev@company.com");

// One call — buyer pays, seller receives, both remember
const deal = await net.transact(
  "buyer-bot",
  "seller-bot",
  25,
  "API access for 1 month"
);

console.log(deal.netAmount);     // 24.52
console.log(deal.platformFee);   // 0.48
console.log(deal.buyerMemoryId); // buyer remembers the purchase
console.log(deal.sellerMemoryId);// seller remembers the sale
```

Both agents store the deal in their memory. Next time they interact, they remember the relationship.

## Step 4: Fraud Detection (Built In)

You don't need to configure anything — fraud detection is on by default:

```typescript
const agent = MnemoPay.quick("my-agent", {
  fraud: {
    maxChargesPerMinute: 10,
    maxChargesPerHour: 50,
    blockThreshold: 0.75,
  }
});

// This will be checked against velocity limits,
// anomaly detection, and geo-enhanced risk scoring
const tx = await agent.charge(1000, "Large purchase");
// If risk score > 0.75, the charge is blocked
```

The fraud system includes:
- Velocity checks (per-minute, per-hour, per-day)
- Statistical anomaly detection (z-score)
- Geo-enhanced risk scoring (country tracking, rapid-hop detection)
- OFAC sanctions screening
- Trust dampening (consistent agents get lower false-positive rates)

## Step 5: Verify the Ledger

```typescript
const summary = await agent.verifyLedger();
console.log(summary.balanced);   // true — always
console.log(summary.entryCount); // total ledger entries
console.log(summary.accounts);   // all accounts and balances
```

Zero penny drift. Every time.

## Real Payment Rails

When you're ready for real money, plug in a payment rail:

```typescript
import { PaystackRail } from "@mnemopay/sdk";

// Africa (NGN, GHS, ZAR, KES)
const paystack = new PaystackRail(process.env.PAYSTACK_SECRET_KEY);
const agent = MnemoPay.quick("my-agent", { paymentRail: paystack });

// Same API — now charges go through Paystack
const tx = await agent.charge(5000, "Service fee");
```

Three rails available: Paystack (Africa), Stripe (global), Lightning (BTC).

## MCP Server

If you're using Claude or another MCP-compatible assistant:

```bash
claude mcp add mnemopay -s user -- npx -y @mnemopay/sdk
```

Now Claude can charge, settle, remember, and recall directly through tool calls.

## What's Next

I'm building toward Agent FICO — a credit score for AI agents. The idea: if you combine persistent memory with payment history, you get a trust signal that's much richer than transaction volume alone.

An agent with 40 memories from 20 successful deals has 2x the credit signal of one with just bare transaction logs.

Memory is the credit file. Payments are the proof.

---

**GitHub**: [mnemopay/mnemopay-sdk](https://github.com/mnemopay/mnemopay-sdk)
**npm**: [@mnemopay/sdk](https://npmjs.com/package/@mnemopay/sdk)
**Landing page**: [getbizsuite.com/mnemopay](https://getbizsuite.com/mnemopay)

378 tests. MIT licensed. Free to start.
