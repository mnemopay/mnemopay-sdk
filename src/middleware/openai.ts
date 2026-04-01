/**
 * OpenAI Middleware — wraps any OpenAI client so memory becomes invisible.
 *
 * Every chat.completions.create call automatically:
 * 1. Recalls the top 5 memories and injects them as system context
 * 2. Calls OpenAI with the enriched messages
 * 3. Stores the conversation exchange as a new memory
 * 4. Returns the response exactly as OpenAI would
 */

import type { MnemoPayLite, MnemoPay, Memory } from "../index.js";

type Agent = MnemoPayLite | MnemoPay;

interface ChatMessage {
  role: string;
  content: string | null;
  [key: string]: unknown;
}

interface CreateParams {
  model: string;
  messages: ChatMessage[];
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

function extractExchange(messages: ChatMessage[], response: any): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const assistantContent =
    response?.choices?.[0]?.message?.content ?? "[no response]";
  const userContent =
    typeof lastUser?.content === "string" ? lastUser.content : "[no user message]";
  return `User: ${userContent.slice(0, 300)}\nAssistant: ${assistantContent.slice(0, 300)}`;
}

interface OpenAILike {
  chat: {
    completions: {
      create: (...args: any[]) => Promise<any>;
    };
  };
}

export class MnemoPayMiddleware {
  /**
   * Wrap an OpenAI client instance. Returns a proxy with an identical API,
   * but chat.completions.create auto-injects and stores memories.
   */
  static wrap<T extends OpenAILike>(
    client: T,
    agent: Agent,
    opts?: { recallLimit?: number },
  ): T & { memories: Agent } {
    const recallLimit = opts?.recallLimit ?? 5;
    const originalCreate = client.chat.completions.create.bind(client.chat.completions);

    const wrappedCreate = async (params: CreateParams, ...rest: any[]) => {
      // 1. Recall memories
      const memories = await agent.recall(recallLimit);
      const memoryContext = formatMemoriesAsContext(memories);

      // 2. Inject into system message
      const enrichedMessages = [...params.messages];
      if (memoryContext) {
        const systemIdx = enrichedMessages.findIndex((m) => m.role === "system");
        if (systemIdx >= 0) {
          enrichedMessages[systemIdx] = {
            ...enrichedMessages[systemIdx],
            content: (enrichedMessages[systemIdx].content || "") + memoryContext,
          };
        } else {
          enrichedMessages.unshift({
            role: "system",
            content: `You are a helpful assistant with persistent memory.${memoryContext}`,
          });
        }
      }

      // 3. Call OpenAI
      const response = await originalCreate({ ...params, messages: enrichedMessages }, ...rest);

      // 4. Store the exchange as a memory
      try {
        const exchange = extractExchange(params.messages, response);
        await agent.remember(exchange);
      } catch {
        // Non-blocking: don't fail the response if memory store fails
      }

      return response;
    };

    // Create a proxy that intercepts chat.completions.create
    const proxy = new Proxy(client, {
      get(target, prop) {
        if (prop === "memories") return agent;
        if (prop === "chat") {
          return new Proxy(target.chat, {
            get(chatTarget, chatProp) {
              if (chatProp === "completions") {
                return new Proxy(chatTarget.completions, {
                  get(compTarget, compProp) {
                    if (compProp === "create") return wrappedCreate;
                    return (compTarget as any)[compProp];
                  },
                });
              }
              return (chatTarget as any)[chatProp];
            },
          });
        }
        return (target as any)[prop];
      },
    });

    return proxy as T & { memories: Agent };
  }
}
