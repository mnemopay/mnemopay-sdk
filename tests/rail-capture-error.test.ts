/**
 * RailCaptureError — normalized capture-failure errors across rails.
 *
 * Verifies:
 *  1. The error class shape (fields + preserved `.originalError`).
 *  2. `hintFor` mapping for the common failure modes.
 *  3. `runRailCapture` wrap/pass-through behavior.
 *  4. Real rails (Stripe, Paystack) wrap provider errors into RailCaptureError
 *     while leaving input-validation guards as plain Errors.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RailCaptureError,
  runRailCapture,
  StripeRail,
  PaystackRail,
  MockRail,
} from "../src/rails/index.js";

describe("RailCaptureError — class", () => {
  it("preserves the original error and exposes consistent fields", () => {
    const original = new Error("card declined: insufficient_funds");
    const err = new RailCaptureError("stripe", original, {
      externalId: "pi_123",
      amount: 12.5,
      agentId: "agent-1",
      currency: "usd",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RailCaptureError);
    expect(err.name).toBe("RailCaptureError");
    expect(err.railName).toBe("stripe");
    expect(err.originalError).toBe(original);
    expect((err as { cause?: unknown }).cause).toBe(original);
    expect(err.externalId).toBe("pi_123");
    expect(err.amount).toBe(12.5);
    expect(err.agentId).toBe("agent-1");
    expect(err.currency).toBe("usd");
    expect(err.message).toContain("stripe");
    expect(err.message).toContain("card declined");
  });

  it("handles non-Error causes (string / object / undefined)", () => {
    expect(new RailCaptureError("mock", "boom").message).toContain("boom");
    expect(new RailCaptureError("mock", { code: "E_X" }).originalError).toEqual({ code: "E_X" });
    expect(() => new RailCaptureError("mock", undefined)).not.toThrow();
  });

  it("lets an explicit hint override the derived one", () => {
    const err = new RailCaptureError("stripe", new Error("x"), { hint: "manual hint" });
    expect(err.hint).toBe("manual hint");
    expect(err.message).toContain("manual hint");
  });
});

describe("RailCaptureError.hintFor", () => {
  it("maps the common provider failure modes", () => {
    expect(RailCaptureError.hintFor(new Error("Insufficient funds"))).toMatch(/insufficient/i);
    expect(RailCaptureError.hintFor({ code: "idempotency_error", message: "x" })).toMatch(/idempotency/i);
    expect(RailCaptureError.hintFor(new Error("authorization has expired"))).toMatch(/expired/i);
    expect(RailCaptureError.hintFor({ status: 429, message: "Too Many Requests" })).toMatch(/rate limited/i);
    expect(RailCaptureError.hintFor({ status: 401, message: "Unauthorized" })).toMatch(/auth/i);
    expect(RailCaptureError.hintFor(new Error("hold not found"))).toMatch(/not found/i);
    expect(RailCaptureError.hintFor({ code: "ETIMEDOUT", message: "timeout" })).toMatch(/network/i);
  });

  it("returns undefined for an unrecognized error", () => {
    expect(RailCaptureError.hintFor(new Error("something weird happened"))).toBeUndefined();
  });
});

describe("runRailCapture", () => {
  it("returns the value on success", async () => {
    const out = await runRailCapture("mock", {}, async () => 42);
    expect(out).toBe(42);
  });

  it("wraps a thrown error into a RailCaptureError, preserving the cause", async () => {
    const original = new Error("provider exploded");
    await expect(
      runRailCapture("lightning", { externalId: "rhash_1", amount: 3 }, async () => {
        throw original;
      }),
    ).rejects.toMatchObject({
      name: "RailCaptureError",
      railName: "lightning",
      originalError: original,
      externalId: "rhash_1",
      amount: 3,
    });
  });

  it("passes an existing RailCaptureError through unchanged (idempotent)", async () => {
    const inner = new RailCaptureError("stripe", new Error("orig"));
    let caught: unknown;
    try {
      await runRailCapture("mock", {}, async () => {
        throw inner;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(inner);
  });
});

describe("StripeRail.capturePayment — error wrapping", () => {
  it("wraps a Stripe provider error and preserves it as .originalError", async () => {
    const providerError = Object.assign(new Error("Your card has insufficient funds."), {
      code: "insufficient_funds",
    });
    const client = {
      paymentIntents: {
        capture: async () => {
          throw providerError;
        },
      },
    };
    const rail = StripeRail.fromClient(client as any);

    let caught: unknown;
    try {
      await rail.capturePayment("pi_fail", 10);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RailCaptureError);
    const err = caught as RailCaptureError;
    expect(err.railName).toBe("stripe");
    expect(err.originalError).toBe(providerError);
    expect(err.externalId).toBe("pi_fail");
    expect(err.hint).toMatch(/insufficient/i);
  });
});

describe("PaystackRail.capturePayment — error wrapping", () => {
  let rail: PaystackRail;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    rail = new PaystackRail("sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("wraps a network/provider failure into RailCaptureError", async () => {
    const netError = new Error("fetch failed: ECONNRESET");
    globalThis.fetch = (async () => {
      throw netError;
    }) as typeof globalThis.fetch;

    let caught: unknown;
    try {
      await rail.capturePayment("mnemo_ref_net", 1000);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RailCaptureError);
    const err = caught as RailCaptureError;
    expect(err.railName).toBe("paystack");
    expect(err.originalError).toBe(netError);
    expect(err.hint).toMatch(/network/i);
  });

  it("leaves the input-validation guard as a plain Error (not RailCaptureError)", async () => {
    await expect(rail.capturePayment("", 100)).rejects.toThrow("reference is required");
    const caught = await rail.capturePayment("", 100).catch((e) => e);
    expect(caught).not.toBeInstanceOf(RailCaptureError);
  });
});

describe("MockRail.capturePayment — success path unaffected", () => {
  it("returns a captured result without wrapping", async () => {
    const rail = new MockRail();
    const res = await rail.capturePayment("mock_hold_1", 5);
    expect(res.status).toBe("captured");
  });
});
