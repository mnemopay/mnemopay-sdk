# MnemoPay Cold DM Templates

**Rule: never send these verbatim.** Every message must reference something specific to the person or their repo. The templates are scaffolds for the parts that are the same every time — the hook, the proof, the ask. The *opener* is hand-written every time.

**Framework:** Nick Saraev (icebreaker → specific pain → one-line proof → CTA). 4-step follow-up. No attachments on first touch.

---

## MCP server author — Twitter / X DM (public wedge)

### First touch

> hey [name] — saw your [specific-thing: "new `embed_document` tool" / "the rate-limit rewrite you shipped last week" / "that crazy README meme"]. actually useful.
>
> building mnemopay — an SDK that lets you charge per-tool-call on your MCP server, down to 0.1¢ via Lightning. agent FICO gates freeloaders automatically.
>
> it's live on npm and i'm giving it away free forever to the first 10 MCP servers that adopt it. would [repo name] want in? zero ask except a logo in your README.

**Customize:** the specific-thing. If you can't find one, don't send the DM.

### Follow-up 1 (day 4)

> hey — figured that got buried. 60-second version: `npm i @mnemopay/sdk` → 2 lines in your tool handler → you can charge 0.002 USD per call and users auto-settle via Lightning. no stripe integration, no KYB.
>
> repo: github.com/mnemopay/mnemopay-sdk
> if not a fit, no worries at all. just didn't want to disappear on you.

### Follow-up 2 (day 10 — only if they liked anything, replied, or RT'd)

> one more thought — if [repo name] handles [specific paid workload: "embeddings" / "code execution" / "model inference"], the math on sub-cent billing actually works: 100K calls at 0.002 = $200 you'd otherwise eat. happy to show you the calculator: [calculator.html link]

### Follow-up 3 (day 20 — breakup)

> gonna stop poking here. if per-call billing becomes a priority later, the 10-slot free-forever tier is still open until filled. good luck with [repo name] — watching from the cheap seats.

---

## MCP server author — GitHub issue comment (public wedge, optional second channel)

**Only post on issues that are actually about billing, payments, rate limiting, or abuse.** Never post unsolicited "check out our SDK" comments. That's spam.

> FWIW — ran into something similar last month building [MnemoPay]. We ended up building an SDK that does per-call billing with Agent Credit Score gating so abusive callers get down-ranked automatically. Might be overkill for this issue specifically but if per-tool billing is on your roadmap, happy to show what we did: https://github.com/mnemopay/mnemopay-sdk
>
> Not trying to hijack the thread — feel free to ignore if not useful.

---

## MCP author — email (if public)

**Subject:** 2 lines to charge per-call on [repo name]?

> Hi [name],
>
> Saw [specific thing in their repo]. Nice work.
>
> I'm the author of mnemopay — an SDK that slots into an MCP server to charge per-call (down to 0.1¢ via Lightning) with Agent Credit Score automatically gating abusive callers. Goes in with 2 lines in your tool handler.
>
> Giving it away free forever to the first 10 MCP servers that adopt it. Logo in your README is the only ask. Would [repo name] be a fit?
>
> Jerry
> https://github.com/mnemopay/mnemopay-sdk
> https://mnemopay.com/calculator.html — chargeback calculator if useful for context

---

## African fintech / SaaS founder — LinkedIn DM (private wedge)

### First touch

> Hi [name] — I saw [specific company thing: fundraise / product launch / blog post about scaling on Paystack].
>
> I'm the founder of MnemoPay — an SDK that lets AI agents transact on Paystack rails with full chargeback defence via cryptographic receipts. Built it specifically because Stripe doesn't work for the use case and everyone else is shoving USDC at it, which is not what African SaaS needs.
>
> Not pitching investment — pitching a paid pilot. $500/mo design-partner slot if it's a fit. Happy to show you the receipts in a 20-min call.

### Follow-up 1 (day 5)

> Hi [name] — following up. If Paystack + AI agents isn't something on your roadmap, totally fine to tell me to stop. I'd rather hear "no" once than guess for three weeks.

---

## Chargeback-pain SaaS founder — email (Merkle evidence wedge)

**Subject:** saw [company] got hit with that agent-dispute wave — we built the receipts

> Hi [name],
>
> [1 specific sentence referencing a public pain signal — a tweet, a blog post, a HN comment complaining about agent disputes.]
>
> We built MnemoPay specifically for this. Every agent transaction produces a cryptographic receipt (HMAC-signed, Merkle-rooted, offline-verifiable) that you can attach to dispute packages. Our calculator estimates [X] SaaS companies at your scale are bleeding [$Y]/yr on agent chargebacks alone: https://mnemopay.com/calculator.html
>
> Not asking for a demo call. Asking for 10 minutes to see if the shape of the problem matches. If not, I'll drop it.
>
> — Jerry
> mnemopay.com · github.com/mnemopay/mnemopay-sdk

---

## Response playbook

**If they reply "tell me more":** send the calculator link + 1 concrete example + ask for a 15-min call time. Do not dump documentation. Let them click.

**If they reply "not a fit":** reply "thanks for the honesty, appreciate it. if it ever becomes a fit the 10-slot free-forever tier will probably still have space." That's it. Don't defend.

**If they reply with a technical question:** answer the question, then ask one back. Keep the thread alive.

**If they go silent after expressing interest:** wait 5 days, send "hey — still on your radar?" exactly once. Then breakup.

**If they book a call:** put it on the tracker immediately. Next action = "prep demo for [their specific use case]" not "have a generic call."
