import { describe, it, expect } from "vitest";
import { CohereMiddleware } from "../../src/middleware/cohere.js";
import type { Memory } from "../../src/index.js";

/**
 * Minimal agent stub matching the `MnemoPayLite | MnemoPay` surface the
 * middleware touches: `recall(limit)` + `remember(content)`. Records every
 * call so tests can assert recall + remember behavior without standing up
 * the full SDK.
 */
function makeFakeAgent(seedMemories: Memory[] = []) {
  const recallCalls: number[] = [];
  const rememberCalls: string[] = [];
  const agent = {
    recall: async (limit: number) => {
      recallCalls.push(limit);
      return seedMemories.slice(0, limit);
    },
    remember: async (content: string) => {
      rememberCalls.push(content);
      return { id: "mem_" + rememberCalls.length, content } as any;
    },
  } as any;
  return { agent, recallCalls, rememberCalls };
}

/**
 * Mock Cohere v2 client. `chat(params)` records every call and returns a
 * canned response shaped like the real v2 SDK output
 * (`response.message.content[].text`).
 */
function makeFakeCohere(opts?: { reject?: boolean }) {
  const chatCalls: any[] = [];
  const client = {
    async chat(params: any) {
      chatCalls.push(params);
      if (opts?.reject) {
        throw new Error("charter-denied: tool not permitted");
      }
      return {
        id: "co_resp_1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello from cohere" }],
        },
        finishReason: "COMPLETE",
      };
    },
  };
  return { client, chatCalls };
}

describe("CohereMiddleware.wrap", () => {
  it("returns a wrapped client that preserves the chat API + exposes the agent", () => {
    const { client } = makeFakeCohere();
    const { agent } = makeFakeAgent();
    const wrapped = CohereMiddleware.wrap(client, agent);

    expect(typeof wrapped.chat).toBe("function");
    expect((wrapped as any).memories).toBe(agent);
  });

  it("calls agent.recall() before chat (default + custom limit)", async () => {
    const { client } = makeFakeCohere();
    const { agent, recallCalls } = makeFakeAgent();
    const wrapped = CohereMiddleware.wrap(client, agent);

    await wrapped.chat({
      model: "command-r-plus",
      messages: [{ role: "user", content: "Plan my Tuesday." }],
    });
    expect(recallCalls).toEqual([5]);

    const wrapped12 = CohereMiddleware.wrap(makeFakeCohere().client, agent, {
      recallLimit: 12,
    });
    await wrapped12.chat({ model: "command-r", messages: [{ role: "user", content: "hi" }] });
    expect(recallCalls[1]).toBe(12);
  });

  it("injects recalled memories into a system turn (creating one if absent)", async () => {
    const seed: Memory[] = [
      { id: "m1", content: "user prefers terse replies", score: 0.91 } as any,
      { id: "m2", content: "user lives in Melissa TX", score: 0.83 } as any,
    ];
    const { client, chatCalls } = makeFakeCohere();
    const { agent } = makeFakeAgent(seed);
    const wrapped = CohereMiddleware.wrap(client, agent);

    await wrapped.chat({
      model: "command-r-plus",
      messages: [{ role: "user", content: "Plan my Tuesday." }],
    });

    const sentMessages = chatCalls[0].messages;
    expect(sentMessages[0].role).toBe("system");
    expect(sentMessages[0].content).toContain("user prefers terse replies");
    expect(sentMessages[0].content).toContain("user lives in Melissa TX");
    expect(sentMessages[0].content).toContain("Agent Memory");
    // Original user message is preserved untouched after the system turn.
    expect(sentMessages[1]).toEqual({ role: "user", content: "Plan my Tuesday." });
  });

  it("appends memory to an existing system turn rather than adding a new one", async () => {
    const seed: Memory[] = [{ id: "m1", content: "audit-mode on", score: 0.7 } as any];
    const { client, chatCalls } = makeFakeCohere();
    const { agent } = makeFakeAgent(seed);
    const wrapped = CohereMiddleware.wrap(client, agent);

    await wrapped.chat({
      model: "command-r-plus",
      messages: [
        { role: "system", content: "You are a strict brand-voice copyeditor." },
        { role: "user", content: "ping" },
      ],
    });

    const sentMessages = chatCalls[0].messages;
    expect(sentMessages.filter((m: any) => m.role === "system")).toHaveLength(1);
    expect(sentMessages[0].content).toContain("You are a strict brand-voice copyeditor.");
    expect(sentMessages[0].content).toContain("audit-mode on");
  });

  it("stores the exchange via agent.remember() on success", async () => {
    const { client } = makeFakeCohere();
    const { agent, rememberCalls } = makeFakeAgent();
    const wrapped = CohereMiddleware.wrap(client, agent);

    await wrapped.chat({
      model: "command-r-plus",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(rememberCalls).toHaveLength(1);
    expect(rememberCalls[0]).toContain("User: What is the weather?");
    expect(rememberCalls[0]).toContain("Assistant: hello from cohere");
  });

  it("propagates provider errors and stores nothing on failure", async () => {
    const { client } = makeFakeCohere({ reject: true });
    const { agent, rememberCalls } = makeFakeAgent();
    const wrapped = CohereMiddleware.wrap(client, agent);

    await expect(
      wrapped.chat({ model: "command-r-plus", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/charter-denied/);
    expect(rememberCalls).toHaveLength(0);
  });

  it("returns the raw provider response unchanged + survives remember() failure", async () => {
    const { client } = makeFakeCohere();
    const brokenAgent = {
      recall: async () => [],
      remember: async () => {
        throw new Error("storage offline");
      },
    } as any;
    const wrapped = CohereMiddleware.wrap(client, brokenAgent);

    const response = await wrapped.chat({
      model: "command-r-plus",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.message.content[0].text).toBe("hello from cohere");
    expect(response.finishReason).toBe("COMPLETE");
  });
});
