---
title: "Agent memory is three-dimensional — and your vector DB only covers one axis"
canonical_url: https://getbizsuite.com/mnemopay/
tags: [ai, agents, memory, vectordb]
published: true
---

I want to push back on something that's become the default for agent memory: one vector database, call it "memory," ship it.

It works until the agent needs to answer a question that isn't about similarity.

Here's the thing that finally made it click for me. Three facts, all about the same person:

1. Alice is the tech lead on Project Atlas.
2. Alice changed teams three weeks ago.
3. Alice once approved a $40K cloud bill without a ticket.

These are three completely different kinds of memory. If I stuff them into one Pinecone index with OpenAI embeddings, I can ask "who runs Atlas" and it will probably surface fact #1. Great. But now ask "is Alice still the right person to ping on Atlas" and it has no idea, because that's a *temporal* question — #2 invalidates #1, and the vector index doesn't know what "invalidate" means. Ask "should Alice be auto-approved for this charge" and it's hopeless, because that's a *relational* question — it needs the link between Alice and the charge and the outcome.

## The three axes

The way I've ended up modeling it:

**Semantic** — what is true, embedded for fuzzy retrieval. This is what vector DBs are actually good at. Analogies, paraphrases, "things that sound like X."

**Episodic** — when it happened, in order, with enough metadata that "three weeks ago" means something. This is basically a ledger. If you squint, it's a transaction log. Vector similarity is useless here — you need time as a first-class axis, and you need the ability to mark old facts as superseded without deleting them.

**Relational** — how things connect. Alice → Atlas → cloud-bill → approved. Graph shape. You don't want to embed a join; you want to traverse it. This is where most "put it in the vector DB" systems quietly fail — they can retrieve the two nodes but not the edge.

A single vector store gives you the first one and fakes the other two. That's the gap.

## Why this matters if the agent is touching money

I build a thing called MnemoPay. It's the SDK I wish existed when I started wiring agents to Stripe — it gives every agent an identity, a ledger, and a credit score between 300 and 850 that moves based on actual behavior. The reason I bring it up is that the credit-score thing is not a vector problem. At all.

To decide whether to trust an agent with $50, I need:

- **Semantic**: "has this agent done work that looks like this before?" — vector.
- **Episodic**: "did it pay back the last N times, and in what order, and how recently?" — ledger.
- **Relational**: "does it share an edge with an agent that was banned last week?" — graph.

If I only had the semantic half, the score would be something like "agents that feel similar to trustworthy agents get a boost." That's astrology. The episodic and relational axes are what let the number actually mean something.

The same shape shows up everywhere real-money agents go. Fraud detection wants episodic velocity ("five charges in one minute"). Escrow resolution wants relational lineage ("which invoice does this dispute point at"). Human-in-the-loop approval wants the full three: "is this charge semantically similar to past approved ones, has this agent been paying back on time, and does it touch anyone on the flagged list."

## What I'd actually do

This is the part I'm still iterating on, so take it as a working opinion, not a framework.

For the semantic axis I use a normal vector store — I don't have strong feelings here, they're mostly interchangeable for this use case. For the episodic axis I keep an append-only log with timestamps, monotonically-increasing sequence numbers, and a cheap "supersedes" pointer for corrections. For the relational axis I keep a small property graph that gets rebuilt on demand from the other two — it's not load-bearing, it's a view.

The key move is that a "recall" operation hits all three and merges the results with a policy you care about. For payments the policy is "recency dominates" — episodic wins ties. For a research agent the policy might be "semantic dominates." You probably don't want one answer to that question globally. You want it per agent, per task.

## The honest caveat

None of this is novel. People built this into databases in the 1970s. What's new is that the agent-framework crowd rediscovered vector databases, flattened the problem into one axis, and moved on. That works fine for chat. It stops working the moment the agent is allowed to remember anything that needs to be *un-remembered* later — which is most things, once the agent is doing real work.

If you're building an agent that touches money, schedules, or anything irreversible, pressure-test whether your "memory" can tell you *when* something was true. If it can't, you have one dimension, not three.

---

MnemoPay is Apache 2.0 and gives you the episodic + credit-score layer specifically. `npm install @mnemopay/sdk` or `pip install mnemopay`. Code's at github.com/mnemopay, docs at [getbizsuite.com/mnemopay](https://getbizsuite.com/mnemopay/).

I'm the only person on it, so sharp feedback on where the three-axis model breaks down for your workload is the fastest way I get better at this.
