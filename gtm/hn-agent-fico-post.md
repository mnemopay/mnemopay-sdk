# HN Post — Agent FICO Score

## Title (pick one)
**Option A (Show HN):**
`Show HN: Agent FICO – a credit score for AI agents (300-850)`

**Option B (Ask HN / discussion bait):**
`Ask HN: How are you measuring trust in your AI agents before they touch money?`

---

## Body (paste into HN text field — plain text, no markdown)

I've been building agent infrastructure for a while and kept running into the same problem: how do you know if an AI agent is trustworthy *before* you let it execute a transaction?

We have credit scores for humans. We have fraud detection for card transactions. But for AI agents — which now autonomously spend money, make API calls, and take actions with real consequences — we have basically nothing. You either trust the agent fully or you don't deploy it.

So I built Agent FICO: a 300–850 behavioral score for AI agents, modeled explicitly on how FICO works for consumer credit.

The five components:

  - Transaction history (35%) — success/failure patterns over time
  - Memory integrity (20%) — Merkle-verified audit trail, detects prompt injection and memory poisoning
  - Behavioral consistency (15%) — EWMA anomaly detection on spending patterns
  - Identity stability (15%) — cryptographic proof the agent hasn't been swapped or hijacked
  - Context reliability (15%) — does the agent behave the same across different sessions?

Agents start at 650. Score drops when they fail transactions, exhibit anomalous behavior, or trip the canary honeypots. Score rises as they build a clean track record. High-FICO agents get elevated transaction limits; low-FICO agents get rate-limited automatically.

Five lines to add it to any agent:

```
npm install @mnemopay/sdk
```

```typescript
import { MnemoPay } from '@mnemopay/sdk';
const mp = MnemoPay.quick('my-agent');
const tx = await mp.charge(50, 'API call — fetch customer data');
const score = await mp.agentFicoScore(); // 300-850
```

The SDK is Apache 2.0, the score calculation is open, and there's an interactive demo at getbizsuite.com/mnemopay/agent-fico.html if you want to see the breakdown.

GitHub: https://github.com/mnemopay/mnemopay-sdk

Curious whether anyone else has thought about this problem differently. Especially interested in talking to people who've had an agent go rogue in production and what they wish they'd had.

---

## Posting tips

- Post Tuesday–Thursday between 8–10am ET (peak HN traffic)
- Use Option A title — "Show HN" gets ~2x comments vs generic posts
- Drop the GitHub link in first comment too (HN buries links in body)
- First comment template:
  "Happy to answer questions. For context: I've been dogfooding this on our own BizSuite agent fleet — 
   the score caught 3 cases of drift that would have caused billing errors before they happened. 
   Also open to feedback on the scoring weights — the 35/20/15/15/15 split is our current best guess, 
   not gospel."
- If it gets traction, reply to every comment in the first 2 hours — HN algorithm rewards engagement velocity

## Cross-post sequence (same day)
1. HN (morning)
2. r/LocalLLaMA — "I built a credit score for AI agents" (afternoon, different angle: safety/alignment)
3. Dev.to article expanding the post (use autopost pipeline)
4. Twitter thread breaking down each of the 5 components with code examples
