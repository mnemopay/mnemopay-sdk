import { describe, it, expect } from "vitest";
import { StripeRail } from "../src/rails/index.js";

/**
 * Opt-in LIVE-API settlement check against Stripe TEST mode.
 *
 *   STRIPE_TEST_KEY=sk_test_... npx vitest run tests/live-stripe.test.ts
 *
 * Skipped unless STRIPE_TEST_KEY is set. A key that is not `sk_test_` is
 * refused outright: this test must never be able to move real money.
 *
 * Every other rail test in this repo uses mocks or fake keys, so until this has
 * been run green with a real test key, "live settlement" is UNVERIFIED.
 * Test-mode success still doesn't prove production money movement; it proves
 * the hold -> capture -> reverse wiring against Stripe's real API.
 */
const key = process.env.STRIPE_TEST_KEY;

describe.skipIf(!key)("StripeRail — live API, test mode", () => {
  it("refuses anything that is not a test-mode key", () => {
    expect(key!.startsWith("sk_test_")).toBe(true);
  });

  it("hold -> capture settles a real PaymentIntent", async () => {
    if (!key!.startsWith("sk_test_")) throw new Error("refusing to run with a non-test key");
    const rail = new StripeRail(key!);
    const hold = await rail.createHold(5, "mnemopay live-settlement check", "live-check-agent", {
      paymentMethodId: "pm_card_visa", // Stripe's built-in test card
      metadata: { idempotencyKey: `live-check-${Date.now()}` },
    });
    expect(hold.externalId).toMatch(/^pi_/);
    expect(hold.status).toBe("requires_capture");

    const cap = await rail.capturePayment(hold.externalId, 5);
    expect(cap.status).toBe("succeeded");
    expect(cap.receiptId).toBeTruthy();
  }, 30_000);

  it("hold -> reverse cancels without capturing", async () => {
    if (!key!.startsWith("sk_test_")) throw new Error("refusing to run with a non-test key");
    const rail = new StripeRail(key!);
    const hold = await rail.createHold(3, "mnemopay live reverse check", "live-check-agent", {
      paymentMethodId: "pm_card_visa",
      metadata: { idempotencyKey: `live-rev-${Date.now()}` },
    });
    const rev = await rail.reversePayment(hold.externalId, 3);
    expect(rev.status).toBe("reversed");
  }, 30_000);
});
