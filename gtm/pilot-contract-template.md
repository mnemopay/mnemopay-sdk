# MnemoPay Design Partner / Pilot Agreement

**This is a plain-English working document, not final legal text. Both parties will sign a counsel-reviewed version before any money moves.**

**Date:** _________________
**Customer:** _________________ ("Customer")
**Vendor:** J&B Enterprise LLC, a Texas limited liability company, d/b/a MnemoPay, with Jerry Omiagbo as authorized signatory ("MnemoPay")
**Pilot ID:** _________________

---

## 1. What MnemoPay provides

- The **MnemoPay SDK** (npm `@mnemopay/sdk`, currently v1.0.0-beta.1) under a commercial pilot license for the duration of this agreement
- **Founder-led integration support** — Jerry Omiagbo personally implements the initial integration, up to 20 engineering hours included
- **Payment rail access** — Stripe, Paystack, and Lightning rails wired against Customer's own rail accounts (Customer retains custody)
- **Agent Credit Score scoring + anomaly detection** — Customer gets the full 14 modules, not a cut-down version
- **Priority support** during the pilot — same-day response to any blocker, max 24-hour response to anything non-blocking
- **Monthly progress report** — delivered on the 1st of each month, covering transactions processed, disputes, anomalies caught, issues resolved

## 2. What Customer provides

- **One integration point** — a single product, service, or MCP server willing to ship the SDK
- **A technical champion** — one engineer empowered to answer questions and ship fixes
- **Access to the test environment** — staging or sandbox where the SDK can run against real transactions
- **Feedback, written weekly** — what's working, what's not, what's blocking

## 3. Success criteria

This pilot is considered successful if, and only if, at the end of the pilot period:

**Primary metric (one of):**
- ☐ **MCP billing:** ≥ $_____ in real settled revenue through MnemoPay over the pilot period
- ☐ **Chargeback reduction:** ≥ 40% reduction in lost-dispute volume vs. the 3-month period prior to pilot
- ☐ **Agent Credit Score gating:** ≥ 70% reduction in abusive / free-loader traffic on the integrated endpoints
- ☐ **Africa / Paystack:** ≥ $_____ in live Paystack-settled revenue over the pilot period
- ☐ **Custom:** _________________________________________ (write in)

**Secondary metrics:**
- Charge latency p99 ≤ 300ms
- Zero ledger drift (double-entry integrity check passes daily)
- Customer integration time ≤ 1 week
- Zero unplanned production incidents attributable to the SDK

**Both parties sign off on success criteria on day 1.** Changes after day 7 require both signatures.

## 4. Pricing

| Item | Amount |
|---|---|
| Pilot fee | **$_____/month** (default: $500 design-partner, $2,500 commercial pilot) |
| Duration | **3 months** |
| Total committed | $_____ |
| Payment terms | Net 15, first month due at kickoff |
| Transactions included | Unlimited during pilot; standard 1.9% settlement fee applies to real money moved |
| Rail fees | Passed through at cost (Stripe / Paystack / Lightning actuals) |

Pilot pricing is a discount on the production rate and does not renew at pilot rate. Production rate is $_____/month (to be agreed before pilot end).

## 5. Out clause

Either party may terminate this pilot at the end of any month with 7 days written notice. No penalty. Prepaid but unused months are refunded on a pro-rated basis.

## 6. Data & privacy

- **MnemoPay does not hold Customer funds.** All money moves directly between Customer and the underlying rail provider (Stripe / Paystack / Lightning).
- **No telemetry enabled by default.** Optional anonymized error reporting can be turned on with written approval.
- **No Customer transaction data is used to improve MnemoPay** without a separate written data-use agreement.
- **Memory data stays on Customer infrastructure** — MnemoPay's memory module persists locally, not to MnemoPay servers.

## 7. IP

- MnemoPay retains all IP in the SDK and its components.
- Customer retains all IP in Customer applications and Customer data (including transactions and memory generated from Customer operations).
- Customer grants MnemoPay the right to reference Customer's name as a pilot customer **only after written approval of the specific wording**.

## 8. Support level

- **Same business day** response to anything marked BLOCKER
- **Next business day** response to anything else
- **Weekly 30-minute sync** with Jerry Omiagbo for the duration of the pilot
- **Shared Slack or email channel** for async questions

## 9. Regulatory posture — honest disclosure

MnemoPay is a software SDK, not a licensed money transmitter or payment processor. All payment rail operations (Stripe, Paystack, Lightning) are conducted directly between Customer and the underlying rail provider; MnemoPay orchestrates but does not hold Customer funds. Customer is responsible for ensuring their use of the SDK complies with applicable payments regulations in Customer's jurisdictions. MnemoPay will cooperate in good faith with any counsel or compliance review requested.

## 10. Signatures

**Customer:**
Name: _________________
Title: _________________
Date: _________________

**MnemoPay:**
Jerry Omiagbo, Founder
Date: _________________
