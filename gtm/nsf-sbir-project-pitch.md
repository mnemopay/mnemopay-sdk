# NSF SBIR Phase I — Project Pitch: MnemoPay

---

**SUBMIT WHEN:** seedfund.nsf.gov reopens (watch starting April 14, 2026).
Submit Project Pitch first — NSF invites full proposal within ~3 weeks if interested.

**Program:** NSF SBIR Phase I
**Solicitation:** NSF 24-579
**Award ceiling:** $305,000 (6 months)
**Portal:** seedfund.nsf.gov

---

## 1. Company and Team

J&B Enterprise LLC (d/b/a MnemoPay) is a Dallas, TX-based software company founded by Jerry Omiagbo, a full-stack engineer with production experience in distributed systems, payment infrastructure, and AI agent development. MnemoPay is a solo-founded company with a deployed, revenue-generating product and a 716-test open-source codebase under active development.

---

## 2. Innovation

AI agents are being deployed into high-stakes environments — autonomous purchasing, healthcare task execution, financial operations — with no standardized way to verify their behavioral integrity over time. An agent that behaved correctly at deployment may degrade, be manipulated, or silently drift. There is no "credit score" for AI agent behavior, and no tamper-resistant record that regulators, auditors, or counterparties can independently verify.

MnemoPay is a behavioral accountability SDK for AI agents. Its technical stack is not available as a commercial off-the-shelf product:

- **Agent FICO** — a 300-850 behavioral credit score derived from an agent's verified transaction and decision history, computed via EWMA anomaly detection and pattern integrity checks
- **Merkle-anchored audit trails** — every agent action is cryptographically chained using Ed25519 signatures and Merkle tree structures, making retroactive tampering detectable
- **Canary honeypot detection** — synthetic decoy transactions that expose manipulation or prompt injection attacks before they affect real operations
- **Behavioral anomaly engine** — per-agent baseline modeling with asymmetric AIMD rate shaping, drift detection, and circuit breakers

The core research question is: can a lightweight, decentralized behavioral accountability layer provide statistically meaningful early warning of AI agent compromise or drift, without requiring access to the agent's internal model? We believe yes, and Phase I would validate this scientifically.

---

## 3. Societal and Commercial Impact

AI agents are projected to handle trillions of dollars in autonomous transactions by 2028. The absence of standardized behavioral accountability creates systemic risk — in financial services, logistics, healthcare coordination, and government contracting. Regulatory frameworks (EU AI Act Article 12, proposed US AI accountability legislation) are converging on mandatory audit trail requirements but provide no implementation standard.

MnemoPay addresses this gap directly. Commercially, the target customer is any organization deploying AI agents with real-world consequences: enterprise software vendors, fintech platforms, autonomous systems integrators, and government contractors. The SDK is already open-source (Apache 2.0, `@mnemopay/sdk` on npm) with 400K+ downloads, and has live integration with Stripe and Paystack payment rails, enabling real-world validation at scale.

---

## 4. Why NSF

The technical core of MnemoPay sits at the intersection of applied cryptography, behavioral statistics, and distributed systems — all areas NSF has historically funded. Specifically, the Phase I work advances fundamental research in:

- **Trustworthy computing** — can cryptographic audit chains serve as a proxy for behavioral trustworthiness in non-deterministic AI systems?
- **Anomaly detection under distribution shift** — existing EWMA and AIMD models were designed for network traffic; their application to AI agent behavioral scoring is novel and unproven at scale
- **Privacy-preserving auditability** — how do you produce a verifiable behavioral record without exposing the agent's proprietary reasoning or the user's private data?

These are not engineering problems with known solutions. They are open research questions with direct commercial application — exactly the territory NSF SBIR is designed to fund.

---

## 5. Phase I Work Plan ($305K / 6 Months)

**Month 1-2: Baseline research and instrumentation**
Conduct a systematic review of AI agent behavioral drift literature. Instrument the existing MnemoPay EWMA and FICO engines to capture ground-truth anomaly signals across 10+ production agent types (LLM-based, rule-based, hybrid). Establish statistical baselines for what "normal" agent behavior looks like across transaction classes.

**Month 3-4: Adversarial validation**
Design and execute a controlled adversarial test suite — prompt injection, gradual goal drift, Sybil identity attacks, coordinated manipulation — against the canary honeypot and anomaly detection layers. Measure false positive/negative rates. Compare against existing fraud detection benchmarks in financial services (the closest analogous domain).

**Month 4-5: Cryptographic audit trail formalization**
Formalize the Merkle-anchored audit chain design as a publishable specification. Validate tamper-evidence properties under realistic storage and network conditions. Produce a reference implementation suitable for third-party audit.

**Month 5-6: Dissemination and Phase II preparation**
Publish findings in at least one peer-reviewed venue (workshop or conference). Produce a Phase II proposal targeting full-scale deployment validation with 2-3 enterprise pilot partners already in discussion. Deliver open-source release of the validated research instrumentation as a public good.

**Budget allocation (estimated):**
- PI salary / contractor research support: ~$180K
- Cloud infrastructure (stress testing, adversarial simulation): ~$40K
- External technical review and statistical consulting: ~$35K
- Conference travel, dissemination: ~$15K
- Indirect / administrative: ~$35K
