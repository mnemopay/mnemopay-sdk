/**
 * Example 01 — Quick Start (5 lines, zero infrastructure)
 *
 * Run: npx tsx examples/01-quick-start.ts
 */

import { MnemoPay } from "../src/index.js";

const agent = MnemoPay.quick("agent-001");

// Store memories (auto-scored by importance)
await agent.remember("User's name is Marcus");
await agent.remember("Critical: API key rotated today", { importance: 0.95 });

// Recall memories (ranked by importance × recency × frequency)
const memories = await agent.recall();
console.log("Recalled:", memories.map((m) => `[${m.importance.toFixed(2)}] ${m.content}`));

// Charge for work (escrow-based, reputation-gated)
const tx = await agent.charge(5.0, "Generated analytics dashboard");
await agent.settle(tx.id);

// Check profile
const profile = await agent.profile();
console.log("Profile:", profile);
// { id: 'agent-001', reputation: 0.51, wallet: 5.00, memoriesCount: 2, transactionsCount: 1 }
