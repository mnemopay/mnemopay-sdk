import { describe, it, expect } from "vitest";
import { MistralMiddleware } from "../../src/middleware/mistral.js";
import type { Memory } from "../../src/index.js";

/**
 * Minimal agent stub matching the `MnemoPayLite | MnemoPay` surface the
 * middleware touches: `recall(limit)` + `remember(content)`.
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
 * Mock Mistral client. `chat.complete(params)` records every call and
 * returns a canned response shaped like the real SDK output
 * (`choices[0].message.content`, OpenAI-compatible).
 */
function makeFakeMistral(opts?: { reject?: boolean }) {
  const completeCalls: any[] = [];
  const client = {
    chat: {
      async complete(params: any) {
        completeCalls.push(params);
        if (opts?.reject) {
          throw new Error("charter-denied: tool not permitted");
        }
        return {
          id: "ms_resp_1",
          model: params.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "hello from mistral" },
              finishReason: "stop",
            },
          ],
        };
      },
    },
  };
  return { client, completeCalls };
}

describe("MistralMiddleware.wrap", () => {
  it("returns a wrapped client that preserves chat.complete + exposes the agent", () => {
    const { client } = makeFakeMistral();
    const { agent } = makeFakeAgent();
    const wrapped = MistralMiddleware.wrap(client, agent);

    expect(typeof wrapped.chat.complete).toBe("function");
    expect((wrapped as any).memories).toBe(agent);
  });

  it("calls agent.recall() before chat.complete (default + custom limit)", async () => {
    const { client } = makeFakeMistral();
    const { agent, recallCalls } = makeFakeAgent();
    const wrapped = MistralMiddleware.wrap(client, agent);

    await wrapped.chat.complete({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "Plan my Tuesday." }],
    });
    expect(recallCalls).toEqual([5]);

    const wrapped12 = MistralMiddleware.wrap(makeFakeMistral().client, agent, {
      recallLimit: 12,
    });
    await wrapped12.chat.complete({
      model: "mistral-small-latest",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(recallCalls[1]).toBe(12);
  });

  it("injects recalled memories into a system turn (creating one if absent)", async () => {
    const seed: Memory[] = [
      { id: "m1", content: "user prefers terse replies", score: 0.91 } as any,
      { id: "m2", content: "user lives in Melissa TX", score: 0.83 } as any,
    ];
    const { client, completeCalls } = makeFakeMistral();
    const { agent } = makeFakeAgent(seed);
    const wrapped = MistralMiddleware.wrap(client, agent);

    await wrapped.chat.complete({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "Plan my Tuesday." }],
    });

    const sentMessages = completeCalls[0].messages;
    expect(sentMessages[0].role).toBe("system");
    expect(sentMessages[0].content).toContain("user prefers terse replies");
    expect(sentMessages[0].content).toContain("user lives in Melissa TX");
    expect(sentMessages[0].content).toContain("Agent Memory");
    expect(sentMessages[1]).toEqual({ role: "user", content: "Plan my Tuesday." });
  });

  it("appends memory to an existing system turn rather than adding a new one", async () => {
    const seed: Memory[] = [{ id: "m1", content: "audit-mode on", score: 0.7 } as any];
    const { client, completeCalls } = makeFakeMistral();
    const { agent } = makeFakeAgent(seed);
    const wrapped = MistralMiddleware.wrap(client, agent);

    await wrapped.chat.complete({
      model: "mistral-large-latest",
      messages: [
        { role: "system", content: "You are a strict brand-voice copyeditor." },
        { role: "user", content: "ping" },
      ],
    });

    const sentMessages = completeCalls[0].messages;
    expect(sentMessages.filter((m: any) => m.role === "system")).toHaveLength(1);
    expect(sentMessages[0].content).toContain("You are a strict brand-voice copyeditor.");
    expect(sentMessages[0].content).toContain("audit-mode on");
  });

  it("stores the exchange via agent.remember() on success", async () => {
    const { client } = makeFakeMistral();
    const { agent, rememberCalls } = makeFakeAgent();
    const wrapped = MistralMiddleware.wrap(client, agent);

    await wrapped.chat.complete({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "What is the weather?" }],
    });

    expect(rememberCalls).toHaveLength(1);
    expect(rememberCalls[0]).toContain("User: What is the weather?");
    expect(rememberCalls[0]).toContain("Assistant: hello from mistral");
  });

  it("propagates provider errors and stores nothing on failure", async () => {
    const { client } = makeFakeMistral({ reject: true });
    const { agent, rememberCalls } = makeFakeAgent();
    const wrapped = MistralMiddleware.wrap(client, agent);

    await expect(
      wrapped.chat.complete({
        model: "mistral-large-latest",
        messages: [{ role: "user", content: "x" }],
      }),
    ).rejects.toThrow(/charter-denied/);
    expect(rememberCalls).toHaveLength(0);
  });

  it("returns the raw provider response unchanged + survives remember() failure", async () => {
    const { client } = makeFakeMistral();
    const brokenAgent = {
      recall: async () => [],
      remember: async () => {
        throw new Error("storage offline");
      },
    } as any;
    const wrapped = MistralMiddleware.wrap(client, brokenAgent);

    const response = await wrapped.chat.complete({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.choices[0].message.content).toBe("hello from mistral");
    expect(response.choices[0].finishReason).toBe("stop");
  });
});
