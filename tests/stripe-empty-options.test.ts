/**
 * Stripe rejects an EMPTY options object.
 *
 * `paymentIntents.create(params, {})` throws
 *   "Unknown arguments ([object Object]). Did you mean to pass an options object?"
 * inside stripe-node's argument parser, before any HTTP request is made. Both
 * Stripe rails called it exactly that way whenever no idempotency key was
 * supplied, so every such charge failed with what reads like a Stripe API error
 * while never reaching Stripe at all.
 *
 * Found 2026-09-05: Dele's P2P transfers had been attempting MnemoPay receipts
 * for weeks. Each one hit this and was swallowed by a best-effort try/catch, so
 * the substrate recorded zero transactions and nothing surfaced as broken.
 *
 * These tests use a dummy key on purpose. Argument parsing happens before
 * authentication, so a bad key still proves the point: the argument error must
 * not occur, and reaching an auth failure means the call got through.
 */

import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Stripe = require("stripe");

const client = new Stripe("sk_test_dummy_for_argument_parsing", {
  apiVersion: "2026-03-04.preview",
});

const PARAMS = {
  amount: 100,
  currency: "usd",
  capture_method: "manual" as const,
  payment_method_types: ["crypto"],
  payment_method_data: { type: "crypto" },
  payment_method_options: {
    crypto: { mode: "deposit", deposit_options: { networks: ["tempo"] } },
  },
};

async function errorFrom(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message.split("\n")[0];
  }
}

const ARG_ERROR = /Unknown arguments/;

describe("stripe payment intent options argument", () => {
  it("still reproduces the bug when an empty object is passed", async () => {
    // Guards the fix: if a future stripe-node stops rejecting `{}`, this test
    // fails and tells us the workaround is no longer load-bearing, rather than
    // leaving a mysterious conditional behind forever.
    const msg = await errorFrom(() => client.paymentIntents.create(PARAMS, {}));
    expect(msg).toMatch(ARG_ERROR);
  });

  it("accepts the call when the options argument is omitted", async () => {
    const msg = await errorFrom(() => client.paymentIntents.create(PARAMS));
    expect(msg).not.toMatch(ARG_ERROR);
    // Got far enough to be authenticated, which is as far as a dummy key goes.
    expect(msg).toMatch(/Invalid API Key/);
  });

  it("accepts the call with a real idempotency key", async () => {
    const msg = await errorFrom(() =>
      client.paymentIntents.create(PARAMS, { idempotencyKey: "mp_test_key_1" }),
    );
    expect(msg).not.toMatch(ARG_ERROR);
    expect(msg).toMatch(/Invalid API Key/);
  });
});
