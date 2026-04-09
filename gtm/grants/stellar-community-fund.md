# Stellar Community Fund — Application Draft (Dele Remittance Corridor)

**Program:** Stellar Community Fund (SCF)
**URL:** communityfund.stellar.org
**Award:** $15,000 — $150,000+ (paid in XLM), quarterly rounds
**Status:** BLOCKED — requires 2-3 week Soroban integration first (see `../stellar-soroban-decision.md`)
**Entity:** J&B Enterprise LLC, a Texas LLC, d/b/a Dele

---

## Why Dele (not MnemoPay) is the right SCF angle

SCF explicitly prioritizes:
1. Real-world asset tokenization
2. Cross-border remittances, especially Africa
3. Financial inclusion in underserved markets
4. Stablecoin payment use cases

**Dele checks all four:**
- Live ride-hailing + delivery in Nigeria with actual users
- Cross-border NGN↔USD corridor is a fundamental pain point
- Drivers are exactly the "financially underserved" population SCF funds
- Stablecoin (USDC on Stellar) payout to driver wallets solves the NGN volatility problem directly

MnemoPay is a better intellectual fit for Stellar's "agent economy" narrative, but SCF judges are looking for *live user impact*, not R&D. Dele wins on that axis every time.

## Integration scope (the prerequisite work)

1. **Soroban smart contract** for driver payouts — signs off on ride completion, releases USDC to driver's custodial Stellar wallet
2. **NGN off-ramp** via a Nigerian exchange (Yellow Card, Busha, or similar) — driver can convert USDC→NGN in <24h
3. **Dele rider payment** via Paystack NGN (no change) OR optional USDC-on-Stellar for expat riders
4. **MnemoPay Agent FICO** applied to driver reputation scoring — this is the clever hook that ties MnemoPay to Dele without putting MnemoPay at the center of the SCF pitch
5. **Anchor integration** (SEP-24) for NGN on/off ramp compliance

## Application narrative (draft, to be submitted after integration is working)

**Project name:** Dele — Stellar Remittance Corridor for African Gig Workers

**One-sentence description:**
Dele is a live ride-hailing and delivery platform in Nigeria, shipping USDC-on-Stellar payouts to drivers within 24 hours of trip completion — a 40x speedup and 10x cost reduction over existing bank-based payroll.

**Why Stellar:**
The NGN→USD corridor is the single most painful part of running a gig-economy platform in Nigeria. Traditional payouts take 3-7 business days, cost 5-8% in FX fees, and require drivers to maintain a functional bank account. USDC-on-Stellar settles in <5 seconds, costs fractions of a cent, and pays out to a custodial wallet that does not require a bank.

**Traction:**
- Dele is live in Nigeria today (pre-Soroban integration)
- Existing driver base on the platform
- Existing rider volume
- The Soroban integration replaces the current payout rail with a Stellar rail end-to-end

**Funding ask:** $50,000 — $100,000 SCF Build Award

**Use of funds:**
- 40% ($20K-$40K): Founder + 1 contractor salary for 3 months integration + QA
- 20% ($10K-$20K): Anchor / off-ramp partnership fees with Yellow Card or similar
- 20% ($10K-$20K): Security audit of the Soroban payout contract
- 20% ($10K-$20K): Driver onboarding + wallet custody partnership costs

---

## Submission checklist (blocked until Soroban integration is live)

- [ ] Soroban payout contract deployed and tested on Stellar testnet
- [ ] Demo video of NGN→USDC→NGN round-trip under 1 hour
- [ ] Anchor partnership letter (Yellow Card or similar)
- [ ] Metrics from at least 10 live driver payouts on testnet
- [ ] SCF application at communityfund.stellar.org during active round
