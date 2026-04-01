/**
 * Example 06 — Production Mode (Postgres + Redis + Observability)
 *
 * Same API as quick mode — just change MnemoPay.quick() → MnemoPay.create().
 * Requires running Mnemosyne + AgentPay backends (use docker-compose.yml).
 *
 * Run: npx tsx examples/06-production.ts
 */

import { MnemoPay } from "../src/index.js";

// Production mode — connects to real Mnemosyne + AgentPay backends
const agent = MnemoPay.create({
  agentId: "prod-agent-001",
  mnemoUrl: process.env.MNEMO_URL || "http://localhost:8100",
  agentpayUrl: process.env.AGENTPAY_URL || "http://localhost:3100",
  redis: process.env.REDIS_URL || "redis://localhost:6379",
  db: process.env.DATABASE_URL || "postgres://localhost:5432/mnemopay",
  decay: 0.05,
  debug: true,
  mnemoApiKey: process.env.MNEMO_API_KEY,
  agentpayApiKey: process.env.AGENTPAY_API_KEY,
});

// Event listeners for observability
agent.on("ready", () => console.log("Agent connected to backends"));
agent.on("memory:stored", (d) => console.log(`Stored: ${d.content.slice(0, 50)}...`));
agent.on("memory:recalled", (d) => console.log(`Recalled ${d.count} memories`));
agent.on("payment:pending", (d) => console.log(`Escrow: $${d.amount} for "${d.reason}"`));
agent.on("payment:completed", (d) => console.log(`Settled: $${d.amount}`));
agent.on("payment:refunded", (d) => console.log(`Refunded: ${d.id}`));
agent.on("error", (err) => console.error("Agent error:", err));

// Wait for connection
await new Promise((resolve) => agent.on("ready", resolve));

// ── Same API as quick mode ──────────────────────────────────────────────

// Store with full Mnemosyne backend (Hopfield networks, FSRS, Merkle integrity)
await agent.remember("Production memory with Postgres persistence", { importance: 0.9 });
await agent.remember("User prefers TypeScript and dark mode");

// Recall via Mnemosyne's associative search
const memories = await agent.recall(5);
console.log(
  "Recalled:",
  memories.map((m) => m.content)
);

// Charge via AgentPay's escrow system (Bayesian trust, AIS fraud detection)
const tx = await agent.charge(10.0, "Premium analytics report");
await agent.settle(tx.id);

// Full observability
const profile = await agent.profile();
console.log("Profile:", profile);

const logs = await agent.logs(10);
console.log("Recent audit entries:", logs.length);

const history = await agent.history(5);
console.log("Transaction history:", history.map((t) => `$${t.amount} — ${t.status}`));

// Consolidation (triggers Mnemosyne's Dream cycle — ORIENT/GATHER/MERGE/PRUNE)
const pruned = await agent.consolidate();
console.log(`Consolidated: pruned ${pruned} stale memories`);

// Clean up
await agent.disconnect();
