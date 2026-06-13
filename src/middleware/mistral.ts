/**
 * Mistral Middleware — wraps a `@mistralai/mistralai` client so memory
 * becomes invisible.
 *
 * Every `client.chat.complete({ model, messages })` call automatically:
 * 1. Recalls the top 5 memories and injects them as system context
 * 2. Calls Mistral with the enriched messages
 * 3. Stores the conversation exchange as a new memory
 * 4. Returns the response exactly as `@mistralai/mistralai` would
 *
 * Sister to `MnemoPayMiddleware.wrap` (OpenAI) and `GeminiMiddleware.wrap`
 * — same recall → inject → store → return hooks, different provider SDK.
 * Mounted under `@mnemopay/sdk/middleware/mistral`.
 *
 * Why hook `client.chat.complete`: the Mistral API
 * (https://docs.mistral.ai/api/) is OpenAI-compatible — an OpenAI-style
 * `messages: [{ role, content }]` request and a `choices[0].message.content`
 * response. The official SDK nests the call one level deeper than OpenAI
 * (`chat.complete` rather than `chat.completions.create`), so we proxy
 * `chat.complete` specifically.
 */

import type { MnemoPayLite, MnemoPay, Memory } from "../index.js";

type Agent = MnemoPayLite | MnemoPay;

/** A Mistral content chunk — `{ type: "text", text }` for multi-part content. */
interface ContentChunk {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface ChatMessage {
  role: string;
  /** Mistral accepts a plain string OR an array of content chunks. */
  content: string | ContentChunk[] | null;
  [key: string]: unknown;
}

interface CompleteParams {
  model: string;
  messages: ChatMessage[];
  [key: string]: unknown;
}

interface MistralLike {
  chat: {
    complete: (params: CompleteParams, ...rest: any[]) => Promise<any>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function formatMemoriesAsContext(memories: Memory[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (m, i) => `[Memory ${i + 1}] ${m.content} (relevance: ${m.score.toFixed(2)})`,
  );
  return (
    "\n\n--- Agent Memory (auto-injected by MnemoPay) ---\n" +
    lines.join("\n") +
    "\n--- End Memory ---\n"
  );
}

/** Flatten a Mistral message's content (string | chunk[]) into plain text. */
function messageText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Append memory context to a message's content, preserving its shape. */
function appendToContent(
  content: ChatMessage["content"],
  memoryContext: string,
): ChatMessage["content"] {
  if (typeof content === "string" || content == null) {
    return (content || "") + memoryContext;
  }
  return [...content, { type: "text", text: memoryContext }];
}

/**
 * Pull assistant text out of a Mistral chat-completion response. The shape
 * mirrors OpenAI (`choices[0].message.content`), except `content` can also
 * be an array of content chunks in newer SDK versions.
 */
function extractAssistantText(response: any): string {
  try {
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.length) return content;
    if (Array.isArray(content)) {
      const text = content
        .map((c: ContentChunk) => (typeof c?.text === "string" ? c.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  } catch {
    // fall through
  }
  return "[no response]";
}

function extractExchange(messages: ChatMessage[], response: any): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userContent = lastUser ? messageText(lastUser.content) : "[no user message]";
  const assistantContent = extractAssistantText(response);
  return `User: ${userContent.slice(0, 300)}\nAssistant: ${assistantContent.slice(0, 300)}`;
}

export class MistralMiddleware {
  /**
   * Wrap a Mistral client instance. Returns a proxy with an identical API,
   * but `chat.complete(...)` auto-injects recalled memories into the system
   * turn and stores the exchange afterward.
   *
   * @example
   *   import { Mistral } from "@mistralai/mistralai";
   *   import { MistralMiddleware } from "@mnemopay/sdk/middleware/mistral";
   *
   *   const raw = new Mistral({ apiKey: process.env.MISTRAL_API_KEY! });
   *   const mistral = MistralMiddleware.wrap(raw, agent);
   *   const r = await mistral.chat.complete({
   *     model: "mistral-large-latest",
   *     messages: [{ role: "user", content: "Plan my Tuesday." }],
   *   });
   */
  static wrap<T extends MistralLike>(
    client: T,
    agent: Agent,
    opts?: { recallLimit?: number },
  ): T & { memories: Agent } {
    const recallLimit = opts?.recallLimit ?? 5;
    const originalComplete = client.chat.complete.bind(client.chat);

    const wrappedComplete = async (params: CompleteParams, ...rest: any[]) => {
      // 1. Recall memories.
      const memories = await agent.recall(recallLimit);
      const memoryContext = formatMemoriesAsContext(memories);

      // 2. Inject into the system turn (create one if absent).
      const enrichedMessages = [...params.messages];
      if (memoryContext) {
        const systemIdx = enrichedMessages.findIndex((m) => m.role === "system");
        if (systemIdx >= 0) {
          enrichedMessages[systemIdx] = {
            ...enrichedMessages[systemIdx],
            content: appendToContent(enrichedMessages[systemIdx].content, memoryContext),
          };
        } else {
          enrichedMessages.unshift({
            role: "system",
            content: `You are a helpful assistant with persistent memory.${memoryContext}`,
          });
        }
      }

      // 3. Call Mistral.
      const response = await originalComplete(
        { ...params, messages: enrichedMessages },
        ...rest,
      );

      // 4. Store the exchange as a memory (non-blocking).
      try {
        const exchange = extractExchange(params.messages, response);
        await agent.remember(exchange);
      } catch {
        // Non-blocking: don't fail the response if memory store fails.
      }

      return response;
    };

    const proxy = new Proxy(client, {
      get(target, prop) {
        if (prop === "memories") return agent;
        if (prop === "chat") {
          return new Proxy(target.chat, {
            get(chatTarget, chatProp) {
              if (chatProp === "complete") return wrappedComplete;
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
