---
name: Feature request
about: Propose a new primitive, rail, or governance module
title: "[feat] "
labels: enhancement
assignees: ''
---

## Problem

<!-- What can't you do today with the SDK? -->

## Proposal

<!-- Sketch the API. Public surface only — don't propose internal refactors. -->

```ts
// e.g.
import { NewThing } from "@mnemopay/sdk/...";
const x = new NewThing(...).doStuff();
```

## Why this belongs in the SDK (vs in your app code)

<!-- Be honest. If this is a one-off helper for your codebase, it probably doesn't belong here.
     The SDK is for things multiple agent runtimes need. -->

## Trust / compliance implications

- [ ] Does this primitive sign anything?
- [ ] Does it produce Article 12 audit events?
- [ ] Does it weaken any existing guarantee (FiscalGate, charter, Merkle audit)?
- [ ] Does it require a new payment rail integration?

## Alternatives considered

<!-- What did you try in user-land first? -->
