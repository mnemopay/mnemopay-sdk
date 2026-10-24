const https = require('https');

function appendForm(parts, key, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(parts, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendForm(parts, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

function stripeFormEncode(params = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(params)) appendForm(parts, key, value);
  return parts.join('&');
}

function envPriceId(env, lookupKey) {
  const normalized = String(lookupKey || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return env[`MNEMOPAY_STRIPE_PRICE_${normalized}`] || env[`STRIPE_PRICE_${normalized}`] || null;
}

function checkoutPaymentMethodTypes(env = process.env) {
  return String(env.STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES || 'card,us_bank_account')
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);
}

function defaultStripeRequester(secretKey) {
  return async function request(method, path, params = {}) {
    const isGet = method.toUpperCase() === 'GET';
    const query = isGet ? stripeFormEncode(params) : '';
    const body = isGet ? '' : stripeFormEncode(params);
    const options = {
      hostname: 'api.stripe.com',
      path: `${path}${query ? `?${query}` : ''}`,
      method: method.toUpperCase(),
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
      },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let payload;
          try {
            payload = raw ? JSON.parse(raw) : {};
          } catch {
            payload = { error: { message: raw || `Stripe HTTP ${res.statusCode}` } };
          }
          if (res.statusCode >= 400) {
            const message = payload?.error?.message || `Stripe HTTP ${res.statusCode}`;
            const err = new Error(message);
            err.statusCode = res.statusCode;
            err.payload = payload;
            reject(err);
            return;
          }
          resolve(payload);
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  };
}

function createStripeBillingClient({ secretKey, env = process.env, requester } = {}) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required for live Stripe billing sessions');
  const request = requester || defaultStripeRequester(secretKey);

  async function resolvePriceId(lookupKey, explicitPriceId) {
    if (explicitPriceId) return explicitPriceId;
    const fromEnv = envPriceId(env, lookupKey);
    if (fromEnv) return fromEnv;
    const result = await request('GET', '/v1/prices', {
      active: 'true',
      limit: 1,
      lookup_keys: [lookupKey],
    });
    const price = result?.data?.[0];
    if (!price?.id) throw new Error(`No active Stripe price found for lookup key ${lookupKey}`);
    return price.id;
  }

  async function createCheckoutSession({
    accountId,
    priceLookupKey,
    priceId,
    plan,
    interval,
    successUrl,
    cancelUrl,
    customer,
    customerEmail,
  }) {
    const resolvedPriceId = await resolvePriceId(priceLookupKey, priceId);
    return request('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      payment_method_types: checkoutPaymentMethodTypes(env),
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: accountId,
      customer: customer || undefined,
      customer_email: customer ? undefined : customerEmail || undefined,
      metadata: { accountId, priceLookupKey, plan, interval },
      subscription_data: {
        metadata: { accountId, priceLookupKey, plan, interval },
      },
    });
  }

  async function createPortalSession({ customer, returnUrl }) {
    if (!customer) throw new Error('stripe customer id required');
    return request('POST', '/v1/billing_portal/sessions', {
      customer,
      return_url: returnUrl,
    });
  }

  // Retrieve a checkout session by id. Used by /api/checkout/session/:id so
  // /thanks.html can hand the user their freshly-provisioned API key.
  async function retrieveCheckoutSession(sessionId) {
    if (!sessionId) throw new Error('sessionId required');
    return request('GET', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {});
  }

  return {
    createCheckoutSession,
    createPortalSession,
    resolvePriceId,
    retrieveCheckoutSession,
  };
}

module.exports = {
  createStripeBillingClient,
  checkoutPaymentMethodTypes,
  defaultStripeRequester,
  envPriceId,
  stripeFormEncode,
};
