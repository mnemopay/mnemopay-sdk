/**
 * Example 05 — Agents Hiring Agents (multi-agent coordination)
 *
 * A manager agent hires specialist agents, pays them via escrow,
 * rates their work, and remembers performance for future hiring decisions.
 *
 * Run: npx tsx examples/05-agents-hiring-agents.ts
 */

import { MnemoPay } from "../src/index.js";

const manager = MnemoPay.quick("manager-001", { debug: true });
const coder = MnemoPay.quick("coder-001");
const reviewer = MnemoPay.quick("reviewer-001");

// ── Round 1: Manager builds institutional memory ────────────────────────

console.log("\n=== Round 1: First Hiring Round ===\n");

// Manager remembers past performance
await manager.remember("coder-001 delivered fast but had 2 bugs last time", { importance: 0.8 });
await manager.remember("reviewer-001 caught all bugs, took 30min longer", { importance: 0.75 });
await manager.remember("Always pair coder-001 with a reviewer for quality", { importance: 0.9 });

// Manager recalls who performed well
const memories = await manager.recall();
console.log(
  "Manager recalls:",
  memories.map((m) => m.content)
);

// Manager hires coder via escrow
const coderJob = await manager.charge(5.0, "Code sorting algorithm");
console.log(`Hired coder-001 for $5.00 (tx: ${coderJob.id})`);

// Coder delivers clean work this time
await manager.settle(coderJob.id);
await manager.remember("coder-001 delivered clean code this time, no bugs", { importance: 0.85 });
console.log("Coder delivered — payment settled, memory reinforced");

// Manager hires reviewer
const reviewJob = await manager.charge(3.0, "Review sorting algorithm");
await manager.settle(reviewJob.id);
await manager.remember("reviewer-001 approved code in 10min, fast turnaround", { importance: 0.8 });
console.log("Reviewer approved — payment settled");

// ── Round 2: Manager uses accumulated memory ────────────────────────────

console.log("\n=== Round 2: Smarter Hiring ===\n");

const round2Memories = await manager.recall(10);
console.log(
  "Manager now knows:",
  round2Memories.map((m) => `[${m.score.toFixed(2)}] ${m.content}`)
);

// Manager profile: spent $8, full performance history
const managerProfile = await manager.profile();
console.log("\nManager profile:", managerProfile);

// Each agent has their own reputation
const coderProfile = await coder.profile();
const reviewerProfile = await reviewer.profile();
console.log("Coder profile:", coderProfile);
console.log("Reviewer profile:", reviewerProfile);

console.log("\n=== Key Insight ===");
console.log("The manager's memories of agent performance persist across sessions.");
console.log("Next hiring round uses accumulated memory for better decisions.");
console.log("Reputation compounds: reliable agents earn more, flaky ones get fewer jobs.");
