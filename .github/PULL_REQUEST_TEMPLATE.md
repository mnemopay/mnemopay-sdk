<!-- PR title in conventional-commits format, e.g.: feat(identity): add resolveDid for did:web -->

## What this PR does

<!-- One paragraph. The diff is the spec; this is the cover note. -->

## Why

<!-- Link the issue this closes. If no issue, explain why a drive-by PR was the right call.
     Drive-by PRs > 20 lines of behavior change without a prior issue may be closed. -->

Closes #

## Public API delta

<!-- Required if you touched src/index.ts or any /export subpath. Otherwise delete this section. -->

```diff
+ export { newThing } from "./new-thing.js";
```

## Tests

- [ ] New behavior has a new spec
- [ ] Bug fix has a regression spec proving the bug
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] No new runtime deps (or, if there is, explain below)

## Trust-substrate checks

- [ ] Doesn't weaken the Merkle audit chain
- [ ] Doesn't weaken FiscalGate enforcement
- [ ] Doesn't change charter check semantics without a CHANGELOG note
- [ ] Doesn't import the root `@mnemopay/sdk` from another package's source (use a subpath; see CONTRIBUTING.md)

## CHANGELOG

- [ ] Added an entry under `## [Unreleased]` (or the next versioned heading) in `CHANGELOG.md`. Skip if this is a docs-only or test-only change.

## CLA

By opening this PR I confirm I have read [CONTRIBUTING.md](../CONTRIBUTING.md) and agree my contribution is licensed under Apache 2.0.
