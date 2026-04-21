# Staged Marketing — 2026-04-15

All drafts below are written in founder-dev voice with no AI tells (no bold headers in
comments, no "game-changing" framing, no test-count bragging, small honest warts kept
in on purpose). Review, tweak, fire yourself — nothing here has been posted.

Product state claims used throughout:
- MnemoPay v1.0.0-beta on npm + PyPI (pip install mnemopay)
- Three payment rails live: Stripe, Paystack, Lightning
- Agent FICO 300-850, Merkle-verified audit trails, behavioral anomaly detection
- MCP server live at mnemopay-mcp.fly.dev, developer portal at getbizsuite.com/developers
- EU AI Act Article 12 compliance page live
- Apache 2.0

---

## 1. Show HN (hn.algolia.com/submit)

**Title (HN max 80 chars):**

    Show HN: MnemoPay – open-source credit scoring and payment rails for AI agents

**Post body (HN doesn't render markdown — keep it flat):**

    Hey HN,

    I've been writing agent code for about a year and kept running into the
    same wall: I'd let an agent call a tool that moved real money, and I had
    no principled way to decide whether to trust it tomorrow. Everyone
    reinvents a janky allowlist or just YOLOs their Stripe key.

    MnemoPay is the thing I wish existed. It's an npm/pip package (Apache 2.0)
    that gives every agent:

    - an identity (Ed25519)
    - a ledger
    - a 300-850 credit score that moves based on how the agent actually behaves
    - behavioral anomaly detection (EWMA + a few other tricks)
    - a Merkle-verified audit trail
    - three payment rails behind one interface: Stripe, Paystack, Lightning

    The idea is that the agent earns trust by doing boring things well —
    settling escrows, not disputing, staying inside its budget — and you
    gate real-money calls on the score instead of on a static allowlist.

    I didn't set out to build a payments company. I started with memory (I
    was trying to get an agent to remember that a specific API call had
    failed twice and stop making it). Once the memory layer worked, the
    natural next step was "okay, now let it spend $0.40." Which required a
    wallet. Which required knowing whether to trust the wallet holder. Which
    is a credit score. The whole thing dominoed from there.

    A few honest caveats:

    - Agent FICO scoring is genuinely new territory. The formula is public
      and I tune it against my own stress tests, but there's no FICO-for-
      machines industry yet. Treat the score as a signal, not gospel.
    - Lightning rail works but the UX is still "plug in your LND macaroon."
      Stripe + Paystack are the boring happy paths.
    - The Python SDK is a few features behind the TypeScript one.

    Docs + Stripe links + the whole comparison vs Mem0/Kite/Skyfire:
    https://getbizsuite.com/mnemopay/

    Code: https://github.com/mnemopay
    npm: npm install @mnemopay/sdk
    pip: pip install mnemopay

    Would genuinely love to hear where this breaks, what you'd rip out, and
    whether the credit-score framing is the right mental model or if you'd
    shape it differently. I'm the only person on this so sharp feedback is
    the fastest way I get better.

**Notes:**
- Post between 8-10am ET on a Tue/Wed/Thu for best HN traction.
- First comment should NOT be from you — wait 2-3 min then reply to the first
  question; don't seed the thread yourself, mods notice.
- If it dies at rank ~30, don't boost. Let it go and try a contrarian framing next week.

---

## 2. Dev.to article (publish via Dev.to API — key is in memory)

**Title:**

    I gave an AI agent a credit score and it changed how I think about tool permissions

**Tags:** ai, opensource, javascript, webdev

**Body (flat markdown, no nested headers, no bold mid-sentence):**

    The honest origin story: a friend of mine gave an AI agent his card and
    told it to "book a flight for Thursday." It booked two. And a hotel.
    And a newsletter subscription it had apparently found interesting.

    I laughed, then realized I'd been doing the same thing with my own
    scripts, just cheaper. Every time I wire up a tool that touches money,
    I'm making the same decision humans stopped making in the 1950s — who
    do I extend credit to, and based on what.

    For humans we solved this with credit scores. For agents we've been
    solving it with allowlists, cron jobs, and vibes.

    ## What if agents had a real credit score

    That's the thing I spent the last few months building. It's called
    MnemoPay and it's on npm.

    ```bash
    npm install @mnemopay/sdk
    ```

    The core idea is that every agent has an identity, a ledger of every
    call it's ever made, and a score between 300 and 850 that moves based
    on how it behaves. Not how smart its prompt is, not which model it's
    running on — literally did it pay back, did it stay inside the budget,
    did it dispute something it shouldn't have.

    Example: I want an agent to be allowed to spend up to $50 autonomously
    if its score is over 700, but require a human approval under that.

    ```ts
    import { createAgent } from '@mnemopay/sdk';

    const agent = createAgent({ agentId: 'research-bot-01' });
    const score = await agent.fico.getScore();

    if (score >= 700) {
      await agent.wallet.charge({ amountCents: 4000n, memo: 'arxiv fetch' });
    } else {
      await agent.wallet.requestApproval({ amountCents: 4000n });
    }
    ```

    The score is calculated off five factors: payment history, credit
    utilization, account age, inquiry velocity, and behavioral anomaly
    signal. Same shape as human FICO on purpose — I wanted it to be legible
    to someone who already knows credit.

    ## The part I didn't expect

    Once you have a score, all the other knobs change. Fraud detection
    stops being a yes/no and becomes "flag transactions when the score
    drops by N points in one session." Escrows stop being binary and
    become "hold for 48 hours if the score is under 600." Human approval
    stops being a global switch and becomes a score-threshold gate.

    It ends up feeling a lot more like how a bank reasons about a
    customer — because it is.

    ## The less fun parts

    Lightning Network support works but the onboarding is rough. I'm
    still writing "here's how to point this at your LND node" docs.
    Stripe and Paystack are the paths that feel boring, which in
    infrastructure means they're the ones that work.

    The Agent FICO formula is also still in beta. I tune it against my
    own stress tests and my own agents, but there's no "FICO for AI"
    industry body yet. If you end up using it, treat the score as a
    signal you calibrate against your own usage, not a number handed
    down from on high.

    ## If you want to play with it

    - npm: https://www.npmjs.com/package/@mnemopay/sdk
    - pip: https://pypi.org/project/mnemopay/
    - docs + Stripe integration walkthrough: https://getbizsuite.com/mnemopay/
    - GitHub: https://github.com/mnemopay

    It's Apache 2.0. I'd love to hear where the credit-score metaphor
    breaks down for your workload — that's the thing I'm still learning.

**Notes:**
- Post via Dev.to API with `published: true`, canonical_url pointing at getbizsuite.com/mnemopay/
- Let it sit 24 hours before cross-posting to hashnode/medium to avoid duplicate-penalty

---

## 3. Twitter thread (seven tweets, post from @atalldarkman)

**Tweet 1:**

    a friend gave an LLM his card to book one flight

    it booked two, a hotel, and a newsletter it thought was interesting

    that's the problem i've been building for 3 months. thread on what fell out 🧵

**Tweet 2:**

    we've been shipping agents that touch money with allowlists and prayer

    humans solved this in the 1950s. it's called credit

    so i built agent fico — a 300-850 score that moves based on how an agent actually behaves

**Tweet 3:**

    five factors, same shape as human fico on purpose:

    - payment history
    - credit utilization
    - account age
    - inquiry velocity
    - behavioral anomaly

    you gate real-money calls on the score instead of on a static list

**Tweet 4:**

    three payment rails behind one api:

    - stripe for cards
    - paystack for africa
    - lightning for sub-cent micro-txns

    same code, swap the provider env var. this is the thing i'm most happy with

**Tweet 5:**

    honest wart: the lightning onboarding is still "plug in your lnd macaroon"

    stripe + paystack are the boring happy paths

    python sdk is a few features behind the typescript one. i'm catching it up

**Tweet 6:**

    apache 2.0. npm install @mnemopay/sdk. pip install mnemopay

    comparison vs mem0/kite/skyfire + docs live at getbizsuite.com/mnemopay/

    i'm the only person on this so sharp feedback > nice feedback

**Tweet 7:**

    if you're building an agent that touches money and you've been writing
    your own allowlist, try this for an hour and tell me where it breaks

    seriously. the credit-score metaphor is the part i'm still learning and
    the fastest way i get better is real load

---

## Pre-flight checklist

- [ ] HN title under 80 chars ✓
- [ ] HN body is flat text (no markdown)
- [ ] Dev.to has canonical_url set to getbizsuite.com/mnemopay/
- [ ] Tweets each under 280 chars (verified by hand)
- [ ] No "tests passing" brag anywhere in copy
- [ ] All links resolve on https://getbizsuite.com/
- [ ] Stripe pricing page matches what's advertised
- [ ] Jerry read the whole thing and tweaked anything that sounds off

## Post order (recommended)

1. Dev.to article first — it becomes the canonical long-form we can link to
2. HN Show HN next day, morning Eastern, link in text to the Dev.to post
3. Twitter thread an hour after HN lands so HN gets the cold traffic
