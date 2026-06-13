/**
 * Cohere Middleware — wraps a `cohere-ai` v2 client so memory becomes
 * invisible.
 *
 * Every `cohere.chat({ model, messages })` call automatically:
 * 1. Recalls the top 5 memories and injects them as system context
 * 2. Calls Cohere with the enriched messages
 * 3. Stores the conversation exchange as a new memory
 * 4. Returns the response exactly as `cohere-ai` would
 *
 * Sister to `MnemoPayMiddleware.wrap` (OpenAI) and `GeminiMiddleware.wrap`
 * — same API shape, same recall → inject → store → return hooks, different
 * provider SDK. Mounted under `@mnemopay/sdk/middleware/cohere`.
 *
 * Why hook `cohere.chat`: the Cohere v2 Chat API
 * (https://docs.cohere.com/v2/docs/chat-api) takes an OpenAI-style
 * `messages: [{ role, content }]` array, where a system turn carries the
 * preamble. Unlike OpenAI, the v2 response returns assistant text as a
 * CONTENT-BLOCK ARRAY at `response.message.content[].text`, so extraction
 * differs from the OpenAI adapter even though the request shape matches.
 */

import type { MnemoPayLite, MnemoPay, Memory } from "../index.js";

type Agent = MnemoPayLite | MnemoPay;

/** A Cohere v2 content block — `{ type: "text", text }` is the common case. */
interface ContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface ChatMessage {
  role: string;
  /** v2 accepts a plain string OR an array of content blocks. */
  content: string | ContentBlock[] | null;
  [key: string]: unknown;
}

interface CohereChatParams {
  model: string;
  messages: ChatMessage[];
  [key: string]: unknown;
}

interface CohereLike {
  chat: (params: CohereChatParams, ...rest: any[]) => Promise<any>;
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

/** Flatten a Cohere message's content (string | block[]) into plain text. */
function messageText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b?.text === "string" ? b.text : ""))
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
  // Block array — append a trailing text block.
  return [...content, { type: "text", text: memoryContext }];
}

/**
 * Pull assistant text out of a Cohere v2 chat response. v2 returns
 * `response.message.content` as an array of `{ type, text }` blocks.
 * Falls back to the v1-style `response.text` and OpenAI-style shapes for
 * resilience across SDK minor versions.
 */
function extractAssistantText(response: any): string {
  try {
    const blocks = response?.message?.content;
    if (Array.isArray(blocks)) {
      const text = blocks
        .map((b: ContentBlock) => (typeof b?.text === "string" ? b.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
    // v1 SDK: response.text is a string.
    if (typeof response?.text === "string" && response.text.length) {
      return response.text;
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

export class CohereMiddleware {
  /**
   * Wrap a Cohere v2 client instance. Returns a proxy with an identical
   * API, but `chat(...)` auto-injects recalled memories into the system
   * turn and stores the exchange afterward.
   *
   * @example
   *   import { CohereClientV2 } from "cohere-ai";
   *   import { CohereMiddleware } from "@mnemopay/sdk/middleware/cohere";
   *
   *   const raw = new CohereClientV2({ token: process.env.CO_API_KEY! });
   *   const cohere = CohereMiddleware.wrap(raw, agent);
   *   const r = await cohere.chat({
   *     model: "command-r-plus",
   *     messages: [{ role: "user", content: "Plan my Tuesday." }],
   *   });
   */
  static wrap<T extends CohereLike>(
    client: T,
    agent: Agent,
    opts?: { recallLimit?: number },
  ): T & { memories: Agent } {
    const recallLimit = opts?.recallLimit ?? 5;
    const originalChat = client.chat.bind(client);

    const wrappedChat = async (params: CohereChatParams, ...rest: any[]) => {
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

      // 3. Call Cohere.
      const response = await originalChat(
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
        if (prop === "chat") return wrappedChat;
        return (target as any)[prop];
      },
    });

    return proxy as T & { memories: Agent };
  }
}
