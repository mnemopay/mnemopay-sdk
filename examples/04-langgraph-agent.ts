/**
 * Example 04 — LangGraph ReAct Agent (full agent in 15 lines)
 *
 * Drop-in tools give the LLM access to persistent memory and escrow payments.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/04-langgraph-agent.ts
 */

import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { MnemoPay } from "../src/index.js";
import { mnemoTools, agentPayTools } from "../src/langgraph/tools.js";

const agent = MnemoPay.quick("langgraph-agent", { debug: true });
const llm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });

const graph = createReactAgent({
  llm,
  tools: [...mnemoTools(agent), ...agentPayTools(agent)],
  messageModifier:
    "You have persistent memory and a wallet. " +
    "Always recall memories before making decisions. " +
    "Charge users only after delivering real value.",
});

// First interaction
const result1 = await graph.invoke({
  messages: [new HumanMessage("My name is Marcus. I need a sorting algorithm in TypeScript.")],
});
console.log("Agent response:", result1.messages[result1.messages.length - 1].content);

// Second interaction — agent remembers Marcus
const result2 = await graph.invoke({
  messages: [new HumanMessage("What do you remember about me? Also, charge me $3 for that algorithm.")],
});
console.log("Agent response:", result2.messages[result2.messages.length - 1].content);

// Check what happened
const profile = await agent.profile();
console.log("Agent profile:", profile);
