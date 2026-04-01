/**
 * Example 03 — Anthropic Middleware (invisible memory)
 *
 * Same pattern as OpenAI — wrap the client, memory becomes invisible.
 *
 * Run: ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/03-anthropic-middleware.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { MnemoPay } from "../src/index.js";
import { AnthropicMiddleware } from "../src/middleware/anthropic.js";

const agent = MnemoPay.quick("claude-agent");
const ai = AnthropicMiddleware.wrap(new Anthropic(), agent);

// First conversation
const res1 = await ai.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Remember that I prefer TypeScript over Python" }],
});
console.log("Response 1:", res1.content[0].type === "text" ? res1.content[0].text : "");

// Second conversation — preference auto-injected via system parameter
const res2 = await ai.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "What programming language should we use for this project?" }],
});
console.log("Response 2:", res2.content[0].type === "text" ? res2.content[0].text : "");
// → Will recommend TypeScript based on remembered preference

// Access memories directly
const memories = await ai.memories.recall();
console.log("Memories:", memories.map((m) => m.content));
