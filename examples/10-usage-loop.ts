/**
 * Example 10 — Real Usage Loop (builds reputation / credit score history)
 *
 * Simulates an agent doing repeated real work: remember context, perform
 * billable actions (charges), settle, recall, and track score growth.
 *
 * This is the kind of loop real production agents should run.
 * Run locally to bootstrap your own .mnemopay data and see score movement.
 *
 * Usage:
 *   npx tsx examples/10-usage-loop.ts
 *
 * It will:
 * - Create / use local persistence
 * - Perform N cycles of work
 * - Charge small amounts (use test mode or small real if configured)
 * - Report profile + score after each cycle
 *
 * Safety: Starts with very small amounts. Review before scaling.
 */

import MnemoPay from "../src/index.js";

const agent = MnemoPay.quick({
  agentId: process.env.AGENT_ID || "usage-loop-demo",
  // For local dogfood: uses ./.mnemopay by default or MNEMOPAY_DIR
  // persistDir: "./.mnemopay-usage-loop",
});

const CYCLES = parseInt(process.env.LOOP_CYCLES || "12", 10);
const CHARGE_AMOUNT = parseFloat(process.env.CHARGE_AMOUNT || "0.25");

console.log(`Starting usage loop for ${agent.id || "demo-agent"} — ${CYCLES} cycles @ $${CHARGE_AMOUNT} each`);

async function oneCycle(i: number) {
  const task = `Task #${i}: processed batch of customer data, generated summary`;
  
  // 1. Remember context (builds memory history)
  await agent.remember(`${task}. User context: prefers concise reports and JSON output.`, {
    importance: 0.6 + (i % 5) * 0.05,
    tags: ["production", "loop", `cycle-${i}`],
  });

  // 2. Do billable work → charge (this drives score)
  const receipt = await agent.charge({
    amount: CHARGE_AMOUNT,
    currency: "USD",
    reason: task,
    // counterpartyId can help with behavioral patterns
  });

  // 3. Settle (real completion)
  await agent.settle(receipt.id);

  // 4. Occasional recall (builds recall history)
  if (i % 3 === 0) {
    const recalled = await agent.recall({ limit: 5, query: "preferences" });
    console.log(`  Cycle ${i}: recalled ${recalled.length} memories`);

    // Bonus: demonstrate cache path (see examples/11-claude-cache-benchmark.ts for full savings numbers)
    // const cacheBlock = await agent.recall("preferences", 5, { formatForClaudeCache: true });
    // pass cacheBlock to Anthropic for ~90% cheaper subsequent turns
  }

  // 5. Get current profile / score
  const prof = await agent.profile();
  const score = (prof as any).reputationScore ?? (prof as any).fico ?? "n/a";

  console.log(`Cycle ${i}: charged+settled $${CHARGE_AMOUNT} | profile score ~${score} | txs: ${(prof as any).transactionsCount || "?"}`);

  return receipt;
}

async function main() {
  for (let i = 1; i <= CYCLES; i++) {
    try {
      await oneCycle(i);
      // Small delay to simulate real pacing
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      console.error(`Cycle ${i} failed:`, e);
      // Continue to build partial history
    }
  }

  const final = await agent.profile();
  console.log("\n=== Loop complete ===");
  console.log("Final profile:", JSON.stringify(final, null, 2));
  console.log("\nTip: Check your local .mnemopay dir or run with the MCP `profile` / `history` tools.");
}

main().catch(console.error);
