/**
 * LangGraph Tools — drop-in tools for createReactAgent.
 *
 * import { mnemoTools, agentPayTools } from "@mnemopay/sdk/langgraph";
 * const graph = createReactAgent({ llm, tools: [...mnemoTools(agent), ...agentPayTools(agent)] });
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { MnemoPayLite, MnemoPay } from "../index.js";

type Agent = MnemoPayLite | MnemoPay;

/**
 * Memory tools: recall, store, reinforce
 */
export function mnemoTools(agent: Agent) {
  const recallMemories = tool(
    async ({ limit }) => {
      const memories = await agent.recall(limit);
      if (memories.length === 0) return "No memories found.";
      return memories
        .map((m, i) => `${i + 1}. [score:${m.score.toFixed(2)}] ${m.content}`)
        .join("\n");
    },
    {
      name: "recall_memories",
      description:
        "Recall the agent's most relevant memories, ranked by importance × recency × frequency. " +
        "Always call this before making decisions or answering questions about past interactions.",
      schema: z.object({
        limit: z
          .number()
          .min(1)
          .max(20)
          .default(5)
          .describe("Number of memories to recall (1-20)"),
      }),
    }
  );

  const storeMemory = tool(
    async ({ content, importance }) => {
      const id = await agent.remember(content, importance !== undefined ? { importance } : undefined);
      return `Memory stored (id: ${id})`;
    },
    {
      name: "store_memory",
      description:
        "Store a new memory. Use this for important facts, user preferences, decisions, " +
        "and anything worth remembering across sessions. Importance is auto-scored if omitted.",
      schema: z.object({
        content: z.string().describe("The fact, preference, or observation to remember"),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Manual importance (0-1). Omit for auto-scoring."),
      }),
    }
  );

  const reinforceMemory = tool(
    async ({ id, boost }) => {
      await agent.reinforce(id, boost);
      return `Memory ${id} reinforced by +${boost}`;
    },
    {
      name: "reinforce_memory",
      description:
        "Boost a memory's importance when external signals confirm it was valuable. " +
        "Use after a memory leads to a successful action or correct decision.",
      schema: z.object({
        id: z.string().describe("Memory ID to reinforce"),
        boost: z
          .number()
          .min(0.01)
          .max(0.5)
          .default(0.1)
          .describe("Importance boost amount (0.01-0.5)"),
      }),
    }
  );

  return [recallMemories, storeMemory, reinforceMemory];
}

/**
 * Payment tools: charge, settle, check balance
 */
export function agentPayTools(agent: Agent) {
  const chargeUser = tool(
    async ({ amount, reason }) => {
      try {
        const tx = await agent.charge(amount, reason);
        return `Escrow created: $${amount.toFixed(2)} for "${reason}" (tx: ${tx.id}, status: pending). Call settle_payment to finalize.`;
      } catch (err: any) {
        return `Charge failed: ${err.message}`;
      }
    },
    {
      name: "charge_user",
      description:
        "Create an escrow charge for work delivered. The charge is held pending until " +
        "settled. Maximum charge is $500 × agent reputation. Only charge AFTER delivering value.",
      schema: z.object({
        amount: z
          .number()
          .positive()
          .max(500)
          .describe("Amount in USD to charge (max $500)"),
        reason: z
          .string()
          .min(5)
          .describe("Clear description of the value delivered"),
      }),
    }
  );

  const settlePayment = tool(
    async ({ txId }) => {
      try {
        const tx = await agent.settle(txId);
        return `Payment settled: $${tx.amount.toFixed(2)}. Reputation boosted. Recent memories reinforced.`;
      } catch (err: any) {
        return `Settlement failed: ${err.message}`;
      }
    },
    {
      name: "settle_payment",
      description:
        "Finalize a pending escrow transaction. This moves funds to the wallet, " +
        "boosts reputation by +0.01, and reinforces recently-accessed memories by +0.05.",
      schema: z.object({
        txId: z.string().describe("Transaction ID from charge_user"),
      }),
    }
  );

  const checkBalance = tool(
    async () => {
      const bal = await agent.balance();
      const profile = await agent.profile();
      return (
        `Wallet: $${bal.wallet.toFixed(2)} | Reputation: ${bal.reputation.toFixed(2)} | ` +
        `Memories: ${profile.memoriesCount} | Transactions: ${profile.transactionsCount}`
      );
    },
    {
      name: "check_balance",
      description: "Check wallet balance, reputation score, and agent statistics.",
      schema: z.object({}),
    }
  );

  return [chargeUser, settlePayment, checkBalance];
}
