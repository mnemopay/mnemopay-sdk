# Stellar Soroban Integration — Decision Doc

**Decision required:** MnemoPay or Dele for the Stellar Community Fund (SCF) integration?
**Recommendation:** **Dele.**
**Decided by:** Jerry Omiagbo ✅
**Date:** 2026-04-11

---

## The question

SCF awards $15K-$150K+ for projects that ship live on Stellar. It's one of the highest-ROI items in the grant pipeline, but it requires a real 2-3 week integration first. We have two candidates:

1. **MnemoPay** — add Stellar/USDC as a rail alongside Stripe/Lightning/Paystack/x402
2. **Dele** — replace the NGN driver-payout rail with USDC-on-Stellar, using a Nigerian off-ramp

## Why Dele wins

| Criterion | MnemoPay | Dele |
|---|---|---|
| SCF priority match | Moderate (agent economy is novel) | **Perfect** (cross-border Africa remittance, financial inclusion, real users) |
| Live users at integration time | Low (SDK, not end-user) | **Yes** (existing driver + rider base) |
| Real-world impact narrative | Speculative — "agents will transact" | **Concrete** — "drivers get paid 40x faster at 10x less cost" |
| SCF judge reaction | "interesting, come back when you have users" | "this is exactly what we fund" |
| Integration effort | 1-2 weeks (just another rail) | 2-3 weeks (contract + anchor + off-ramp) |
| Ongoing operational risk | Low (SDK only) | Higher (live user funds at stake) |
| Moat created | Incremental (another rail among many) | **Strategic** (unlocks Africa corridor as primary product wedge) |
| Fits existing J&B LLC strategy | Yes | **Yes and it compounds** (Dele + BizSuite + MnemoPay all benefit) |

**Tiebreaker:** The real question is not "which integration is easier" — it's "which integration creates a compounding asset." Dele with a working Stellar rail becomes a defensible Africa-payments wedge that directly fits:
- Paystack outreach (MnemoPay Africa wedge from `mnemopay-sdk/gtm/outreach.md`)
- Google Black Founders Fund (Africa narrative)
- Dallas Diversity Fund (impact metrics)
- Future Stripe Climate, Visa Everywhere, Mastercard Start Path applications

A MnemoPay-only Stellar integration is "another rail." A Dele Stellar integration is "an African fintech."

## Scope (2-3 week build)

### Week 1 — Contract + testnet
- [ ] Soroban smart contract `dele_payout` with methods:
  - `register_driver(driver_id, wallet) → bool`
  - `complete_ride(ride_id, driver_id, amount_usdc) → receipt`
  - `refund_ride(ride_id) → bool`
- [ ] Rust workspace setup inside `dele-superapp/contracts/soroban/`
- [ ] Deploy to Stellar testnet
- [ ] 30+ unit tests
- [ ] Stellar SDK integration on the Dele backend (Node.js `stellar-sdk`)

### Week 2 — Backend integration + anchor
- [ ] Dele server calls `complete_ride` on trip completion, emits USDC payout
- [ ] Custodial driver wallet provisioning (on signup)
- [ ] Anchor partnership conversation (Yellow Card, Busha, or similar — just a discovery call, real partnership comes later)
- [ ] SEP-24 deposit/withdraw flow stub
- [ ] 10 end-to-end testnet payouts verified

### Week 3 — Mainnet + SCF submission
- [ ] Security review pass on the contract (self-audit + one external set of eyes)
- [ ] Mainnet deployment with a small float ($500-$1000)
- [ ] First 5 real driver payouts in mainnet
- [ ] Demo video: ride → payout → driver wallet → NGN withdrawal, all under 1 hour
- [ ] SCF application submitted (draft is at `gtm/grants/stellar-community-fund.md`)

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Soroban contract bugs lose driver funds | Start with a $500 mainnet float, cap max per-driver payout at $50 |
| Anchor off-ramp friction (KYC) | Launch with USDC custody first, add NGN off-ramp after SCF is submitted |
| 2-3 weeks is optimistic | If slipping, cut Week 3 security review to "send to community for informal review" |
| Jerry bandwidth (many concurrent projects) | Pause: BizSuite SEO, Dele video pipeline, NovaClaw, Dele P0 legal cleanup during this sprint |

## Next step (once Jerry approves)

1. Create `dele-superapp/contracts/soroban/` directory and Rust workspace
2. Scaffold `dele_payout` contract + tests
3. Start Week 1 checklist above
