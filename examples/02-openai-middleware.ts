/**
 * Example 02 — OpenAI Middleware (invisible memory)
 *
 * Memory is injected and stored automatically. The developer never calls
 * remember() or recall() — the middleware handles it transparently.
 *
 * Run: OPENAI_API_KEY=sk-... npx tsx examples/02-openai-middleware.ts
 */

import OpenAI from "openai";
import { MnemoPay } from "../src/index.js";
import { MnemoPayMiddleware } from "../src/middleware/openai.js";

const agent = MnemoPay.quick("assistant-001");
const openai = new OpenAI();
const ai = MnemoPayMiddleware.wrap(openai, agent);

// First conversation — no memories yet
const res1 = await ai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "My name is Marcus and I work on AI agents" }],
});
console.log("Response 1:", res1.choices[0].message.content);

// Second conversation — memories auto-injected
const res2 = await ai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "What do you remember about me?" }],
});
console.log("Response 2:", res2.choices[0].message.content);
// → "You told me your name is Marcus and you work on AI agents"

// Manual memory access still available
const memories = await ai.memories.recall();
console.log("All memories:", memories.map((m) => m.content));
