/**
 * Anthropic Middleware — wraps any Anthropic client so memory becomes invisible.
 *
 * Every messages.create call automatically:
 * 1. Recalls the top 5 memories and injects them into the system parameter
 * 2. Calls Anthropic with the enriched request
 * 3. Stores the conversation exchange as a new memory
 * 4. Returns the response exactly as Anthropic would
 */

import type { MnemoPayLite, MnemoPay, Memory } from "../index.js";

type Agent = MnemoPayLite | MnemoPay;

interface MessageParam {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface CreateParams {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | Array<{ type: string; text: string }>;
  [key: string]: unknown;
}

function formatMemoriesAsContext(memories: Memory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (m, i) => `[Memory ${i + 1}] ${m.content} (relevance: ${m.score.toFixed(2)})`
  );
  return (
    "\n\n--- Agent Memory (auto-injected by MnemoPay) ---\n" +
    lines.join("\n") +
    "\n--- End Memory ---\n"
  );
}

function extractContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

export class AnthropicMiddleware {
  /**
   * Wrap an Anthropic client instance. Returns a proxy with an identical API,
   * but messages.create auto-injects and stores memories.
   */
  static wrap<T extends { messages: { create: (...args: any[]) => Promise<any> } }>(
    client: T,
    agent: Agent,
    opts?: { recallLimit?: number }
  ): T & { memories: Agent } {
    const recallLimit = opts?.recallLimit ?? 5;
    const originalCreate = client.messages.create.bind(client.messages);

    const wrappedCreate = async (params: CreateParams, ...rest: any[]) => {
      // 1. Recall memories
      const memories = await agent.recall(recallLimit);
      const memoryContext = formatMemoriesAsContext(memories);

      // 2. Inject into system parameter
      let system = params.system;
      if (memoryContext) {
        if (typeof system === "string") {
          system = system + memoryContext;
        } else if (Array.isArray(system)) {
          system = [
            ...system,
            { type: "text", text: memoryContext },
          ];
        } else {
          system = `You are a helpful assistant with persistent memory.${memoryContext}`;
        }
      }

      // 3. Call Anthropic
      const response = await originalCreate({ ...params, system }, ...rest);

      // 4. Store the exchange as a memory
      try {
        const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
        const userText = lastUser ? extractContent(lastUser.content).slice(0, 300) : "[no input]";
        const assistantText = response?.content
          ?.filter((b: any) => b.type === "text")
          ?.map((b: any) => b.text)
          ?.join("\n")
          ?.slice(0, 300) ?? "[no response]";
        await agent.remember(`User: ${userText}\nAssistant: ${assistantText}`);
      } catch {
        // Non-blocking
      }

      return response;
    };

    const proxy = new Proxy(client, {
      get(target, prop) {
        if (prop === "memories") return agent;
        if (prop === "messages") {
          return new Proxy(target.messages, {
            get(msgTarget, msgProp) {
              if (msgProp === "create") return wrappedCreate;
              return (msgTarget as any)[msgProp];
            },
          });
        }
        return (target as any)[prop];
      },
    });

    return proxy as T & { memories: Agent };
  }
}
