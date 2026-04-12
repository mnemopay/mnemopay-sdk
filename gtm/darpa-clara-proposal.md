# DARPA CLARA Proposal — MnemoPay
**Program:** Compositional Learning-And-Reasoning for AI (CLARA)
**Solicitation:** DARPA-PA-25-07-02
**Submit at:** https://www.darpa.mil/work-with-us/opportunities/darpa-pa-25-07-02 (also on SAM.gov)
**Deadline:** April 17, 2026
**Award:** Up to $2M over 24 months
**PI:** Jerry Omiagbo, J&B Enterprise LLC

---

## White Paper / Abstract (500 words max — submit first, DARPA will invite full proposal)

**Title:** MnemoPay: Behavioral Merkle Scoring for Cryptographically Provable AI Agent Accountability

**Technical Challenge Addressed**

CLARA seeks systems that make AI behavior tractable, verifiable, and explainable through compositional reasoning. The unsolved problem for deployed AI agents is not reasoning capability — it is behavioral *accountability*: can you prove, after the fact, that a specific agent did what it was supposed to do, in the order it was supposed to do it, without tampering?

Current approaches fail because: (1) audit logs are mutable — any agent with storage access can overwrite them; (2) behavioral baselines are absent — there is no established method to distinguish a malfunctioning agent from a hijacked one; (3) identity continuity is unverified — there is no cryptographic proof that the agent completing a task is the same one that started it.

MnemoPay addresses all three.

**Technical Approach**

MnemoPay implements a five-component behavioral accountability system for AI agents:

1. **Merkle-Anchored Audit Trail (Tamper-Resistant Logging):** Every agent action is hashed and chained as a Merkle tree node. The system exports a root hash at any checkpoint. Any post-hoc modification to any log entry invalidates the chain — detectable by any third party without access to the original log. This provides CLARA's required "verifiable execution trace."

2. **EWMA Behavioral Anomaly Detection:** An exponentially weighted moving average baseline is maintained per agent over a 30-day rolling window. Deviations beyond a configurable threshold (default: 3σ) trigger automated flagging. This provides compositional detection of behavioral drift without requiring labeled training data.

3. **Agent FICO Scoring (300–850):** A five-component credit score modeled on FICO consumer credit: transaction history (35%), memory integrity (20%), behavioral consistency (15%), identity stability (15%), context reliability (15%). The score is deterministic, auditable, and updateable in real time. It provides a single explainable scalar summary of agent behavioral health — exactly the kind of compositional, interpretable metric CLARA seeks.

4. **Ed25519 Identity Keypairs:** Each agent is issued a cryptographic identity at initialization. Session continuity is verified by signature. Identity drift (new key, behavioral fingerprint mismatch, session discontinuity) is flagged automatically. This closes the "agent hijacking" attack surface that standard logging cannot address.

5. **Canary Honeypot Detection:** Synthetic transactions are embedded in the agent's environment at randomized intervals. An agent that processes a honeypot transaction without flagging it demonstrates compromised reasoning. This enables active adversarial testing without human-in-the-loop involvement.

**Current Status**

MnemoPay is an open-source SDK (Apache 2.0, github.com/mnemopay/mnemopay-sdk) with:
- 716 passing tests including 30,000-transaction stress test
- Production deployment on npm (@mnemopay/sdk, 400K+ total downloads)
- MCP server for Claude and other LLM agents
- Stripe and Paystack payment rail integration for real-money agent transactions

The DARPA CLARA award would fund: (1) formal verification of the Merkle integrity properties using Lean4 or Coq; (2) adversarial red-teaming against the canary honeypot layer with DoD-standard threat models; (3) integration with CDAO's RAI evaluation framework for DoD agent deployments.

**Why This Team**

J&B Enterprise LLC is a Texas-based software company that has shipped MnemoPay from zero to production-grade in 18 months, with 716 tests, real payment rail integration, and a live MCP server. We have direct experience with adversarial agent behavior: MnemoPay's anomaly detection was validated against real production billing errors caught before they executed.

**Deliverables (24-month timeline)**
- Month 6: Formal verification proof of Merkle integrity properties (Lean4)
- Month 12: Published adversarial red-team results against 10 attack classes
- Month 18: CDAO RAI framework integration + DoD pilot deployment
- Month 24: Open-source release of formal verification tooling + DARPA technical report

---

## How to Submit

1. Go to: https://www.darpa.mil/work-with-us/opportunities/darpa-pa-25-07-02
2. Register or log in to DARPA's BAA portal (or SAM.gov)
3. Submit a **white paper first** (required before full proposal invitation)
4. White paper format: 5 pages max, include technical approach + team + deliverables
5. If invited: full proposal due within 30 days of invitation

**Key contact on the program:** Check the solicitation PDF for the Program Manager name (typically listed as Contracting Officer's Representative).

---

## One-Paragraph Executive Summary (for cover page)

MnemoPay provides cryptographically provable behavioral accountability for AI agents through five integrated mechanisms: Merkle-anchored tamper-resistant audit trails, EWMA behavioral anomaly detection, Agent FICO scoring (300–850), Ed25519 identity continuity verification, and canary honeypot adversarial testing. The system is open-source (Apache 2.0), production-grade (716 tests, 30K stress-tested), and deployed on npm with 400K+ downloads. DARPA CLARA funding would advance the formal verification of MnemoPay's integrity properties and enable integration with DoD's Responsible AI (RAI) evaluation framework, producing an auditable, composable, and deployable standard for AI agent behavioral accountability.
