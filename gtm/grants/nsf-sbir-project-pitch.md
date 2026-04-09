# NSF SBIR Phase I Project Pitch — MnemoPay

**Program:** NSF SBIR/STTR Phase I (America's Seed Fund)
**Award:** Up to $305,000 non-dilutive, 6-12 month period of performance
**Format:** 3-page Project Pitch → if invited, full Phase I proposal
**Submission URL:** https://seedfund.nsf.gov/
**Status:** DRAFT — hold for Q1-Q2 2026 reopen window (currently paused under CR)
**Entity:** J&B Enterprise LLC, a Texas LLC, d/b/a MnemoPay

---

## 1. Technology innovation (the "what")

MnemoPay is building the first reputation and payments infrastructure for autonomous AI agents — a combined memory + payment primitive that lets an agent accumulate a portable, verifiable trust score ("Agent FICO") as it transacts. Today, when an AI agent buys an API call, spins up a compute job, or hires another agent, there is no persistent way to answer the question "is this agent creditworthy?" — every new vendor re-prices risk from zero. This is the same problem consumer credit solved in the 1950s with FICO, rebuilt for a 2026 market where software agents will be the dominant economic actor.

The technical innovation has three legs:

1. **Merkle-rooted behavioral memory** — every transaction and observed outcome is committed to a tamper-evident Merkle tree, so a vendor can cryptographically verify an agent's claimed history in ~5ms without trusting MnemoPay's servers.
2. **Behavioral-finance-derived scoring** — the Agent FICO score (300-850) is computed from EWMA anomaly detection, loss-aversion penalties, and time-discount behavior, drawing on published behavioral-economics research (Kahneman-Tversky prospect theory, Thaler's Save More Tomorrow).
3. **A charge/settle/refund primitive** — agents transact via an SDK that works across Stripe, Lightning, Paystack, and x402 rails, so reputation accrues across the entire payment stack instead of being siloed per-rail.

## 2. Technical objectives and challenges

- **Objective 1:** Prove Agent FICO predictiveness. Show that score at transaction-time is a statistically significant predictor of chargeback/dispute outcome on a test set of ≥10,000 simulated agent transactions. Challenge: there is no public ground-truth dataset of agent transaction disputes — we will need to build one.
- **Objective 2:** Zero-knowledge verifiability. Let a vendor verify "this agent's FICO ≥ 700 and has ≥6 months of history" without learning the agent's full transaction log. Challenge: zkSNARKs for score computation are expensive; we need to prove the piece-wise linear weighted-sum form of FICO can be constraint-system-friendly.
- **Objective 3:** Adversarial robustness. Show the score cannot be gamed by an agent generating synthetic "good" history. Challenge: designing a Sybil-resistant canary-honeypot test without killing the open API model.

## 3. Market opportunity

- **$2.66B** funded into agent-infrastructure startups in 2026 YTD across Mem0, Kite, Skyfire, AGT.finance, and peers (public data)
- **$10.91B** projected TAM by 2030 for agent-native payment and identity infrastructure (Gartner, a16z public forecasts)
- **Zero competitors** currently offer a combined memory + payments + scoring primitive. Mem0 owns memory, Stripe owns payments, none own reputation.

MnemoPay has already published v1.0.0 on npm (both TypeScript and Python SDKs), has 707 tests passing including a 92-day 5,500-agent stress simulation, and is selling into AI-agent developers today. The SBIR award would fund the specific research objectives above (provenance, ZK, adversarial robustness) that are not commercially funded because they are 12-24 months ahead of product-market fit.

## 4. Company and team

**J&B Enterprise LLC**, a Texas LLC, d/b/a MnemoPay. Founder: Jerry Omiagbo — full-stack engineer, 10+ years, lead architect and sole developer on MnemoPay v0.1 through v1.0.1. Prior work includes BizSuite (20-tool SMB toolkit, live), Dele (ride-hailing/delivery, live in Nigeria), LastingSurvival (e-commerce).

**Why NSF, not private capital:** The three research objectives above are academically interesting but commercially premature. Agent FICO's predictiveness, ZK-verifiable scoring, and adversarial robustness are the kind of problems NSF SBIR was created to fund — they build the public-interest infrastructure layer that every downstream private application will depend on.

## 5. What we'll do with the $305K

| Category | Allocation | Detail |
|---|---|---|
| Founder salary | 60% (~$183K) | Full-time on research objectives, 6 months |
| Research computing | 15% (~$46K) | GPU time for adversarial robustness testing; ZK proof benchmarking |
| Dataset construction | 15% (~$46K) | Building the first public agent-transaction-dispute dataset |
| Academic collaboration | 10% (~$30K) | Research partnership with a university lab on ZK/FICO formalization |

---

## Submission checklist

- [ ] Monitor seedfund.nsf.gov weekly for Project Pitch reopen
- [ ] DUNS / SAM.gov registration current (check J&B Enterprise LLC status)
- [ ] SBIR.gov registration with correct d/b/a
- [ ] Research-institution collaboration letter (optional but strengthens pitch)
- [ ] Past commercialization attestation (MnemoPay v1.0.1 npm release)
