# MnemoPay dashboard deployment

This dashboard is the hosted MnemoPay console: Brain, billing, usage, audit,
members, and developer keys.

## Required production env

```bash
MNEMOPAY_CONSOLE_STORE_DRIVER=postgres
MNEMOPAY_CONSOLE_POSTGRES_URL=postgres://...
MNEMOPAY_SESSION_SECRET=...
MNEMOPAY_PUBLIC_URL=https://dashboard.mnemopay.com
NODE_ENV=production
```

`MNEMOPAY_CONSOLE_POSTGRES_URL` can also be supplied as `NEON_URL` or
`DATABASE_URL`.

## Stripe env

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES=card,us_bank_account
```

`STRIPE_CHECKOUT_PAYMENT_METHOD_TYPES` defaults to `card,us_bank_account` in
code so hosted Checkout supports cards plus ACH account/routing payments. Set it
to `card` to disable ACH without redeploying code.

Optional price id envs. If these are not set, Checkout resolves Stripe Prices by
lookup key:

```bash
STRIPE_PRICE_MNEMOPAY_PRO_MONTHLY=price_...
STRIPE_PRICE_MNEMOPAY_PRO_YEARLY=price_...
STRIPE_PRICE_MNEMOPAY_TEAM_MONTHLY=price_...
STRIPE_PRICE_MNEMOPAY_TEAM_YEARLY=price_...
```

Webhook endpoint:

```text
POST https://dashboard.mnemopay.com/api/v1/billing/stripe/webhook
```

Handled event types:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

## Resend env

```bash
RESEND_API_KEY=re_...
MNEMOPAY_AUTH_EMAIL_FROM="MnemoPay <login@mnemopay.com>"
```

## Maileroo env (onboarding drip after Stripe provisioning)

Required for the 4-touch drip in `dashboard/drip-queue.cjs`. Without these the
drip schedules normally but every send marks the row as `deferred` until the
key is set; the next 5-min tick rehydrates them.

```bash
MAILEROO_API_KEY=mlr_...
MAILEROO_FROM=info@getbizsuite.com
MAILEROO_API_URL=https://smtp.maileroo.com/api/v2/emails
```

Sender domain must be verified at app.maileroo.com (currently
`getbizsuite.com`).

Optional knob — drip tick interval (default 5 min):

```bash
MNEMOPAY_DRIP_TICK_MS=300000
```

## Fly deploy

From `dashboard/`:

```bash
fly secrets set \
  MNEMOPAY_CONSOLE_POSTGRES_URL="postgres://..." \
  MNEMOPAY_SESSION_SECRET="..." \
  MNEMOPAY_PUBLIC_URL="https://dashboard.mnemopay.com" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  RESEND_API_KEY="re_..." \
  MNEMOPAY_AUTH_EMAIL_FROM="MnemoPay <login@mnemopay.com>"

fly deploy
```

## Optional production env

```bash
# CORS allowlist (comma-separated). Without this, prod rejects cross-origin
# requests with credentials. Set to your console host.
MNEMOPAY_CORS_ALLOWLIST=https://dashboard.mnemopay.com,https://mnemopay.com

# Body / webhook size caps. Defaults are 1MB / 2MB.
MNEMOPAY_MAX_BODY_BYTES=1048576
MNEMOPAY_MAX_WEBHOOK_BODY_BYTES=2097152

# Rate limit knobs. Token-bucket: capacity = burst, refill = tokens/sec.
MNEMOPAY_RATE_GENERAL_CAPACITY=120
MNEMOPAY_RATE_GENERAL_REFILL=2
MNEMOPAY_RATE_AUTH_CAPACITY=5
MNEMOPAY_RATE_AUTH_REFILL=0.0833
MNEMOPAY_RATE_WEBHOOK_CAPACITY=60
MNEMOPAY_RATE_WEBHOOK_REFILL=5

# Persistence flush debounce (ms). 0 = synchronous flush per mutation.
MNEMOPAY_SAVE_DEBOUNCE_MS=250

# Log level: debug | info | warn | error.
MNEMOPAY_LOG_LEVEL=info

# Brain bridge — see root .env.example for the response-format note. Setting
# this changes the shape of MCP `recall` responses when the brain produces
# hits. Leave unset on the dashboard host unless you intend the dashboard's
# embedded MCP server to bleed a shared corpus into per-agent recall.
MNEMOPAY_BRAIN_PATH=/data/brain.db
```

## Health & observability

```bash
# Liveness — process up + event loop responsive.
curl https://dashboard.mnemopay.com/healthz

# Readiness — deps reachable + required config present. 503 when not ready.
curl https://dashboard.mnemopay.com/readyz
curl https://dashboard.mnemopay.com/api/v1/ops/readiness

# Prometheus metrics scrape.
curl https://dashboard.mnemopay.com/metrics
```

Exposed metrics: `mnemopay_http_requests_total`, `mnemopay_http_request_duration_ms` (histogram), `mnemopay_rate_limit_denied_total`, `mnemopay_plan_gate_denied_total`, `mnemopay_webhook_events_total`, `mnemopay_persistence_failures_total`, `mnemopay_persistence_duration_ms`, `mnemopay_process_uptime_seconds`.

## Local production-shaped run

```bash
npm install
MNEMOPAY_CONSOLE_STORE_DRIVER=postgres \
MNEMOPAY_CONSOLE_POSTGRES_URL="postgres://..." \
MNEMOPAY_SESSION_SECRET="dev-secret" \
MNEMOPAY_AUTH_RETURN_CODES=true \
npm start
```

## Verification flow

1. Open `/readyz` and confirm `status: ok`.
2. Request a console sign-in code from the Session tab.
3. Confirm the email sends through Resend, or dev code appears when explicitly enabled.
4. Verify the code and confirm `/api/v1/auth/session` returns `authenticated: true`.
5. Create a Stripe Checkout Session from the Billing tab.
6. Complete checkout in Stripe test/live mode.
7. Confirm the webhook provisions the account plan and writes audit events.
