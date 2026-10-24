const assert = require('assert');
const {
  checkoutPaymentMethodTypes,
  createStripeBillingClient,
  envPriceId,
  stripeFormEncode,
} = require('./stripe-billing.cjs');

async function main() {
  const encoded = stripeFormEncode({
    line_items: [{ price: 'price_123', quantity: 1 }],
    metadata: { accountId: 'acct_1' },
  });
  assert(encoded.includes('line_items%5B0%5D%5Bprice%5D=price_123'));
  assert(encoded.includes('metadata%5BaccountId%5D=acct_1'));
  assert.strictEqual(envPriceId({ STRIPE_PRICE_MNEMOPAY_PRO_MONTHLY: 'price_env' }, 'mnemopay_pro_monthly'), 'price_env');
  assert.deepStrictEqual(checkoutPaymentMethodTypes({}), ['card', 'us_bank_account']);
  assert.deepStrictEqual(checkoutPaymentMethodTypes({ STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES: 'card' }), ['card']);

  const calls = [];
  const client = createStripeBillingClient({
    secretKey: 'sk_test_x',
    env: {},
    requester: async (method, path, params) => {
      calls.push({ method, path, params });
      if (path === '/v1/prices') return { data: [{ id: 'price_lookup' }] };
      if (path === '/v1/checkout/sessions') return { id: 'cs_test', url: 'https://checkout.stripe.com/test' };
      if (path === '/v1/billing_portal/sessions') return { id: 'bps_test', url: 'https://billing.stripe.com/test' };
      throw new Error(`unexpected ${path}`);
    },
  });

  const checkout = await client.createCheckoutSession({
    accountId: 'acct_1',
    priceLookupKey: 'mnemopay_pro_monthly',
    plan: 'pro',
    interval: 'monthly',
    successUrl: 'https://app.example/success',
    cancelUrl: 'https://app.example/cancel',
  });
  assert.strictEqual(checkout.id, 'cs_test');
  assert.strictEqual(calls[0].path, '/v1/prices');
  assert.strictEqual(calls[1].params.line_items[0].price, 'price_lookup');
  assert.deepStrictEqual(calls[1].params.payment_method_types, ['card', 'us_bank_account']);
  assert.strictEqual(calls[1].params.subscription_data.metadata.accountId, 'acct_1');

  const portal = await client.createPortalSession({ customer: 'cus_123', returnUrl: 'https://app.example/billing' });
  assert.strictEqual(portal.id, 'bps_test');
  assert.strictEqual(calls[2].path, '/v1/billing_portal/sessions');

  // retrieveCheckoutSession — hits GET /v1/checkout/sessions/:id.
  // /thanks.html relies on this when the success_url redirect lands before
  // the checkout.session.completed webhook does.
  const retrieveCalls = [];
  const retrieveClient = createStripeBillingClient({
    secretKey: 'sk_test_x',
    env: {},
    requester: async (method, path) => {
      retrieveCalls.push({ method, path });
      return { id: 'cs_retrieve_test', payment_status: 'paid', client_reference_id: 'acct_1' };
    },
  });
  const retrieved = await retrieveClient.retrieveCheckoutSession('cs_retrieve_test');
  assert.strictEqual(retrieved.id, 'cs_retrieve_test');
  assert.strictEqual(retrieveCalls[0].method, 'GET');
  assert.strictEqual(retrieveCalls[0].path, '/v1/checkout/sessions/cs_retrieve_test');

  await assert.rejects(() => retrieveClient.retrieveCheckoutSession(''), /sessionId required/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
