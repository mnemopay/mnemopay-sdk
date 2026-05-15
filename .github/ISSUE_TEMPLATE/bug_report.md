---
name: Bug report
about: Something in @mnemopay/sdk does not work as documented
title: "[bug] "
labels: bug
assignees: ''
---

## What you tried

<!-- The minimum failing example. Code, not screenshots. -->

```ts
import { ... } from "@mnemopay/sdk/...";
// ...
```

## What you expected

<!-- One sentence. Cite the README / CHANGELOG line if relevant. -->

## What actually happened

<!-- Full error message, including stack. Redact any DIDs / API keys. -->

```
```

## Environment

- `@mnemopay/sdk` version: <!-- e.g. 1.7.0 or 1.8.0-alpha.0 -->
- Node version: <!-- node -v -->
- OS: <!-- macOS 14.5 / Ubuntu 22.04 / Windows 11 -->
- Subpath import used: <!-- @mnemopay/sdk/recall / /identity / /governance / etc -->
- Bundler (if any): <!-- vite / webpack / esbuild / none -->

## Severity

- [ ] Data loss / corruption (e.g. memory irrecoverable, ledger inconsistent)
- [ ] Crash / unhandled exception in production code path
- [ ] Wrong output (computed score / verdict differs from spec)
- [ ] Cosmetic / docs

## Have you checked

- [ ] [CHANGELOG.md](../CHANGELOG.md) for known-issue notes on your version
- [ ] [CONTRIBUTING.md](../CONTRIBUTING.md) — `subpath import` rule (root import triggers MCP auto-start side-effects)
