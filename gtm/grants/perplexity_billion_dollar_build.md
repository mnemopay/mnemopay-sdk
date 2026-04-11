---
target_venue: Perplexity Billion Dollar Build (8-week competition)
announcement: https://x.com/perplexity_ai/status/2041929222135173466
register: https://www.perplexity.ai/computer/a/the-billion-dollar-build-ZWzIFW.FTaKdLtufMa0yhw
rules: https://www.perplexity.ai/hub/legal/sweepstakes
deadline: kickoff approx 2026-04-14, finale 2026-06-09
prize: up to $1M Perplexity Fund investment + up to $1M Perplexity Computer credits
eligibility: US residents (Jerry / J&B Enterprise LLC, Texas — qualifies)
status: staged — awaiting Jerry's review and fire
---

# MnemoPay — Perplexity Billion Dollar Build submission

## Reality check
Contest is real and currently open. Announced via Perplexity on X within the last 24 hours. 8-week build sprint, finale around 2026-06-09. US-only. Solo founders allowed pending registration form confirmation. Prior draft existed at `C:\Users\bizsu\Desktop\PERPLEXITY_BILLION_DOLLAR_BUILD_APPLICATION.md` (Apr 8, 2026) — this file is the polished, tightened version of that draft, formatted to the structure requested and trimmed to under 800 words.

## One-line thesis
MnemoPay is the credit bureau for AI agents: we score agent trust from memory and payment history so every tool-use API can bill and rate-limit without building its own reputation system.

## Why now
- MCP shipped in 2025 and agent tool-call volume went 10x; every MCP server now needs metering and abuse control it does not have.
- Payment rails are human-shaped (3DS, KYC, chargeback windows) and break inside agent loops that fire 1,000 calls a minute.
- Reputation is the missing primitive. Stripe, Coinbase, Visa, and Nevermined all shipped agent billing this quarter. Nobody shipped agent trust.

## Product proof
- `@mnemopay/sdk` v1.0.1 live on npm (2,046 downloads last week, verified via npm API) and `mnemopay` v1.0.0b1 live on PyPI. 707 passing tests across identity, ledger, fraud, geo, commerce, and stress.
- Agent FICO (300-850), five-factor model mirroring consumer FICO, with EWMA behavioral anomaly detection, Merkle-anchored ledger integrity, and canary honeypots for adversarial agents.
- Real integrations shipping: Stripe, Lightning, and Paystack rails live. Pika Skills PR open, Eliza plugin merged history, MCP server installable in one command. Paid Stripe tiers already converting at getbizsuite.com/mnemopay (Pro $49/mo, Enterprise $299/mo).

## Market
Agentic-AI infrastructure is a $10.91B market in 2026 with $2.66B in disclosed funding so far this year. The closest mapped competitors are AGT.finance (no full stack), Mem0 ($24M, memory only, 88K weekly downloads), and Kite ($33M, payments only). None ship memory plus payments plus reputation in one SDK. Agent FICO is an unclaimed category and the score sharpens with every transaction MnemoPay routes, so the moat compounds.

## Why me
- Solo full-stack founder operating J&B Enterprise LLC (Texas), shipping under four d/b/a's including MnemoPay and GridStamp.
- 17 active repos shipped, including a 707-test SDK across TypeScript and Python plus a working MCP server. Legal-reviewed and hardened: 10/10 vulnerabilities closed in the v0.9.3 fortress audit.
- Profitable-by-design. Paid wedges already live at getbizsuite.com (AI Audit at $997, BizSuite consulting tiers, MnemoPay Pro and Enterprise). Not chasing a pivot — 18 months on agent infra (Mnemosyne to AgentPay to MnemoPay).

## The $1B path
Three revenue layers stack on the same SDK. First, a 1.9% take rate on agent-to-service payments routed through MnemoPay rails. Second, enterprise reputation API licenses on the Experian model — flat platform fee plus per-query pricing for fintechs, marketplaces, and MCP server operators that need to score inbound agent traffic. Third, Agent-FICO-as-a-service SaaS for the long tail of MCP operators who want managed metering and trust scoring without running infrastructure. At 0.5% of agent-mediated commerce volume by 2030 against the conservative end of analyst forecasts, $1B in enterprise value is arithmetic, not ambition.

## What the money unlocks
- Hire one infrastructure engineer and one GTM lead. Stop being the bottleneck on pilot conversion.
- SOC2 Type 1, plus one signed fintech pilot and one signed robotics pilot (warm leads exist via the GridStamp side of the house).
- Ship v2: reputation portability across chains and frameworks, so an agent scored on one MCP server carries its FICO into the next.

## What we build during the 8 weeks
Week 1-2: crawl every public MCP server and agent framework, capture 10K agent identities as the FICO seed set, publish `agentcredit.sh` directory. Week 3-4: ship Stripe Agent Toolkit + Coinbase x402 wrappers that auto-enforce FICO thresholds, plus a Perplexity Computer plug-in that meters every subagent. Week 5-6: close five paid pilots at $2K-$10K/mo using Computer for outbound automation. Week 7: seed deck and data room ($5M at $25M post). Week 8: live demo — cold agent gets scored, makes a purchase, FICO updates, second purchase clears at better terms, Merkle proof verifies the chain end-to-end.

## Registration field cheat sheet
| Field | Answer |
|---|---|
| Company | MnemoPay (d/b/a of J&B Enterprise LLC, Texas) |
| URL | https://getbizsuite.com/mnemopay |
| Founder | Jerry Omiagbo |
| Stage | Pre-seed, revenue-generating |
| Sector | AI Agents / Agent Banking / Fintech Infra |
| Ask | $1M Perplexity Fund + $1M Computer credits |
