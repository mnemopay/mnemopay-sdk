---
name: fico
description: Check the Agent Credit Score / reputation (300-850 range) of an AI agent. Use when the user asks about creditworthiness, trust, reputation, or agent scoring.
---

# Agent Credit Score (Reputation)

Use the MnemoPay MCP `agent_fico_score` (legacy name) or `reputation` tools to check an agent's credit/reputation score.

The score ranges from 300-850 (familiar range for developers; **not affiliated with FICO or any consumer credit bureau**):
- 300-579: Poor — high risk, limited transaction capabilities
- 580-669: Fair — some restrictions, building trust
- 670-739: Good — standard transaction limits
- 740-799: Very Good — elevated trust, higher limits
- 800-850: Exceptional — maximum trust, premium capabilities

When the user asks about credit score, trust, or reputation:
1. Call the reputation or agent scoring tools
2. Also call `reputation` for streak and badge info
3. Call `behavioral_analysis` for spending pattern insights
4. Present a clear summary of the agent's trustworthiness

$ARGUMENTS is optional — use as agent ID if provided.

**Note:** "Agent FICO" is a deprecated internal/legacy alias. MnemoPay is not affiliated with Fair Isaac Corporation.
