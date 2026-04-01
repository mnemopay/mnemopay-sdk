# @mnemopay/sdk

**Give any AI agent memory and a wallet in 5 lines.**

MnemoPay unifies [Mnemosyne](https://github.com/t49qnsx7qt-kpanks/mnemosyne-engine) (cognitive memory) and [AgentPay](https://github.com/t49qnsx7qt-kpanks/agentpay-roa) (escrow economics) into a single SDK. The core innovation: **payment outcomes reinforce the memories that led to successful decisions**.

```typescript
import { MnemoPay } from "@mnemopay/sdk";

const agent = MnemoPay.quick("agent-001");
await agent.remember("User prefers TypeScript");
const memories = await agent.recall();
const tx = await agent.charge(5.00, "Built analytics dashboard");
await agent.settle(tx.id);
```

## Two Modes, One API

| Mode | Constructor | Dependencies | Persistence | Use Case |
|------|------------|-------------|-------------|----------|
| **Prototype** | `MnemoPay.quick("id")` | None | In-memory | Development, testing, demos |
| **Production** | `MnemoPay.create({...})` | Postgres + Redis | Durable | Deployed agents |

Switch by changing one line. No code rewrites.

## Install

```bash
npm install @mnemopay/sdk
```

Optional peer dependencies (install only what you use):

```bash
npm install openai                  # For OpenAI middleware
npm install @anthropic-ai/sdk       # For Anthropic middleware
npm install @langchain/langgraph @langchain/core @langchain/openai  # For LangGraph tools
```

## The Feedback Loop

This is the core differentiator — payment outcomes reinforce memories:

```
Agent recalls memories → Makes decision → Delivers value → Charges user
                                                              ↓
                                                      Payment settles
                                                              ↓
                        Memories accessed in the last hour get +0.05 importance
                                                              ↓
                                    Agent makes better decisions next time
```

Over time, memories that lead to successful transactions become dominant in recall, while memories associated with refunds decay faster.

## API Reference

### Memory Methods

| Method | Description |
|--------|-------------|
| `agent.remember(content, opts?)` | Store a memory. Auto-scored by importance if not specified. |
| `agent.recall(limit?)` | Recall top memories ranked by importance x recency x frequency. |
| `agent.forget(id)` | Delete a memory. |
| `agent.reinforce(id, boost?)` | Boost a memory's importance. |
| `agent.consolidate()` | Prune stale memories below score threshold. |

### Payment Methods

| Method | Description |
|--------|-------------|
| `agent.charge(amount, reason)` | Create an escrow transaction. Reputation-gated. |
| `agent.settle(txId)` | Finalize escrow. Moves funds, boosts reputation, reinforces memories. |
| `agent.refund(txId)` | Refund a transaction. Docks reputation by -0.05. |
| `agent.balance()` | Get wallet balance and reputation score. |

### Observability

| Method | Description |
|--------|-------------|
| `agent.profile()` | Full agent stats (reputation, wallet, memory count, tx count). |
| `agent.logs(limit?)` | Immutable audit trail of all actions. |
| `agent.history(limit?)` | Transaction history, most recent first. |

## Provider Middlewares

### OpenAI (invisible memory)

```typescript
import OpenAI from "openai";
import { MnemoPay } from "@mnemopay/sdk";
import { MnemoPayMiddleware } from "@mnemopay/sdk/middleware/openai";

const agent = MnemoPay.quick("assistant");
const ai = MnemoPayMiddleware.wrap(new OpenAI(), agent);

// Memory is now invisible — auto-injected and auto-stored
const res = await ai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What do you remember?" }],
});
```

### Anthropic (invisible memory)

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { MnemoPay } from "@mnemopay/sdk";
import { AnthropicMiddleware } from "@mnemopay/sdk/middleware/anthropic";

const agent = MnemoPay.quick("claude-agent");
const ai = AnthropicMiddleware.wrap(new Anthropic(), agent);
```

## LangGraph Tools

```typescript
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { MnemoPay } from "@mnemopay/sdk";
import { mnemoTools, agentPayTools } from "@mnemopay/sdk/langgraph";

const agent = MnemoPay.quick("langgraph-agent");
const graph = createReactAgent({
  llm,
  tools: [...mnemoTools(agent), ...agentPayTools(agent)],
});
```

6 tools with full Zod schemas: `recall_memories`, `store_memory`, `reinforce_memory`, `charge_user`, `settle_payment`, `check_balance`.

## Agents Hiring Agents

```typescript
const manager = MnemoPay.quick("manager");
const coder = MnemoPay.quick("coder");

await manager.remember("coder delivered fast but had 2 bugs last time");
const memories = await manager.recall(); // Use memory to decide

const job = await manager.charge(5.00, "Code sorting algorithm");
await manager.settle(job.id);
await manager.remember("coder delivered clean code this time");
// Next round: manager makes better hiring decisions
```

## Production Mode

```bash
docker compose up -d  # Starts Mnemosyne + AgentPay + Postgres + Redis
```

```typescript
const agent = MnemoPay.create({
  agentId: "prod-agent",
  mnemoUrl: "http://localhost:8100",
  agentpayUrl: "http://localhost:3100",
  debug: true,
});

// Same API — now backed by Hopfield networks, Bayesian trust, AIS fraud detection
await agent.remember("Production memory");
const tx = await agent.charge(10.00, "Premium service");
await agent.settle(tx.id);
```

## Architecture

```
Your code
    ↓
@mnemopay/sdk ←── Single import, 12 methods
    ↓              ↓
Mnemosyne API    AgentPay API ←── Separate services (unchanged)
(12 models)      (14 models)
    ↓              ↓
  Redis Streams Bridge ←── Payment outcomes reinforce memories
```

The SDK is the developer-facing layer. The backends do the heavy lifting:
- **Mnemosyne**: Hopfield associative recall, FSRS spaced repetition, Merkle integrity, Dream consolidation
- **AgentPay**: Bayesian trust (Beta distributions), AIS fraud detection, behavioral economics, escrow

## Tests

```bash
npm test  # 67 tests covering memory, payments, feedback loop, security, concurrency
```

## License

MIT

Built by [J&B Enterprise LLC](https://github.com/t49qnsx7qt-kpanks)
