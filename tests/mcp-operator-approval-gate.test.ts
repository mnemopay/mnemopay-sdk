/**
 * S2 follow-up: operator_approval_decide approves/rejects Agent OS approval
 * requests. It was the one approval tool that did not go through
 * requireApprover(), so any agent holding the tool could approve its own
 * request (charge_approve / shop_approve were already gated).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "../src/mcp/server.js";
import { MnemoPayLite } from "../src/index.js";

const ENV_KEYS = ["MNEMOPAY_APPROVER_TOKEN", "MNEMOPAY_ALLOW_SELF_APPROVAL", "MNEMOPAY_OPERATOR_API_KEY", "MNEMOPAY_GATEWAY_URL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const args = { approvalId: "apr_1", decision: "approve", decidedBy: "agent-itself" };

describe("operator_approval_decide needs the approver credential", () => {
  it("is disabled by default (fail closed) before any operator call is made", async () => {
    // Operator creds are configured so the only thing standing in the way is the gate.
    process.env.MNEMOPAY_OPERATOR_API_KEY = "op-key";
    process.env.MNEMOPAY_GATEWAY_URL = "https://gateway.invalid";
    const a = new MnemoPayLite("tenant-a");
    await expect(executeTool(a, "operator_approval_decide", args)).rejects.toThrow(/Approval tools are disabled/);
  });

  it("with MNEMOPAY_APPROVER_TOKEN set, a missing or wrong token is refused", async () => {
    process.env.MNEMOPAY_APPROVER_TOKEN = "human-only-secret";
    process.env.MNEMOPAY_OPERATOR_API_KEY = "op-key";
    process.env.MNEMOPAY_GATEWAY_URL = "https://gateway.invalid";
    const a = new MnemoPayLite("tenant-a");
    await expect(executeTool(a, "operator_approval_decide", args)).rejects.toThrow(/Approver authorization/);
    await expect(executeTool(a, "operator_approval_decide", { ...args, _approverToken: "guess" })).rejects.toThrow(/Approver authorization/);
  });

  it("with the right token the gate passes (and the call proceeds to the operator, which is unreachable here)", async () => {
    process.env.MNEMOPAY_APPROVER_TOKEN = "human-only-secret";
    const a = new MnemoPayLite("tenant-a");
    // Operator not configured -> the error is the operator one, proving we got past the gate.
    await expect(executeTool(a, "operator_approval_decide", { ...args, _approverToken: "human-only-secret" }))
      .rejects.toThrow(/Agent OS operator is not configured/);
  });

  it("MNEMOPAY_ALLOW_SELF_APPROVAL=1 keeps the old behaviour", async () => {
    process.env.MNEMOPAY_ALLOW_SELF_APPROVAL = "1";
    const a = new MnemoPayLite("tenant-a");
    await expect(executeTool(a, "operator_approval_decide", args)).rejects.toThrow(/Agent OS operator is not configured/);
  });
});
