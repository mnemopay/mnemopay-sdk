# SUBPATH-IMPORT-RULE — never import `@mnemopay/sdk` from the root if you can help it

The MnemoPay SDK is a multi-module package. Importing it from the root pulls in **everything**: payment rails, recall engine, MCP server bootstrap, governance runtime, behavioral engine, fraud ML. If your process is itself a stdio MCP server, this is **catastrophic** — the root import auto-starts MnemoPay's MCP server on the same stdio channel and corrupts your JSON-RPC stream.

This is the single sharpest edge in the SDK. Read this page once and you will never trip on it.

---

## The rule

**Always import a subpath that names the surface you need.** Use the root export only when you genuinely want the full SDK.

```ts
//  GOOD — subpath, narrow, no side effects
import { localEmbed, cosineSimilarity } from "@mnemopay/sdk/recall";
import { StripeRail, X402Rail }          from "@mnemopay/sdk/rails";
import { SQLiteStorage }                 from "@mnemopay/sdk/storage";
import { CommerceEngine }                from "@mnemopay/sdk/commerce";
import { OpenAIMiddleware }              from "@mnemopay/sdk/middleware/openai";
import { AnthropicMiddleware }           from "@mnemopay/sdk/middleware/anthropic";
import { mnemoTools }                    from "@mnemopay/sdk/langgraph";
import { MnemoPayClient }                from "@mnemopay/sdk/client";
import { toAp2Credential }               from "@mnemopay/sdk/identity";

//  AVOID inside stdio MCP servers — root import auto-starts our MCP loop
import MnemoPay from "@mnemopay/sdk";
```

The only safe root-import contexts are:

1. **Application processes** (CLIs, web services, scripts) that are not themselves stdio MCP servers.
2. **Test files** that want the full surface.
3. The `@mnemopay/sdk` MCP server itself (you intentionally mount it via `npx @mnemopay/sdk`).

---

## Why this matters

The SDK's `dist/mcp/server.js` runs as a side-effect of being loaded — it spawns a tool registry and starts reading stdin for JSON-RPC messages. When you import `MnemoPay` from the root, the module graph reaches that file. In a regular Node process that's harmless (slightly wasteful — ~3.5 MB extra bundle). Inside another stdio MCP server, it:

- Leaks `[mnemopay-mcp] Tool filter: 14/40 tools exposed` to stderr — visible to MCP clients.
- Races your own JSON-RPC writer on stdout.
- Adds ~3.5 MB to the bundle of every process that loads it.

This was caught building the [brain MCP server](https://github.com/mnemopay/brain) — root import collided with brain's own stdio loop. Fixing it to a subpath import dropped the bundle from **5.57 MB → 2.11 MB** and silenced the stderr leak.

A guard rail (`if (require.main === module)`) is on the SDK roadmap, but the right move stays subpath-first regardless.

---

## Subpath cheat sheet

| Use case                                | Import                                          |
| --------------------------------------- | ----------------------------------------------- |
| Semantic recall / memory only           | `@mnemopay/sdk/recall`                          |
| Payment rails                           | `@mnemopay/sdk/rails`                           |
| SQLite or Postgres storage              | `@mnemopay/sdk/storage`                         |
| Multi-agent commerce engine             | `@mnemopay/sdk/commerce`                        |
| OpenAI middleware proxy                 | `@mnemopay/sdk/middleware/openai`               |
| Anthropic middleware proxy              | `@mnemopay/sdk/middleware/anthropic`            |
| Gemini middleware proxy                 | `@mnemopay/sdk/middleware/gemini`               |
| Cohere middleware proxy                 | `@mnemopay/sdk/middleware/cohere`               |
| Mistral middleware proxy                | `@mnemopay/sdk/middleware/mistral`              |
| LangGraph tools                         | `@mnemopay/sdk/langgraph`                       |
| Browser / React Native universal client | `@mnemopay/sdk/client`                          |
| DID / AP2 / Wallet                      | `@mnemopay/sdk/identity`                        |
| Mount MCP server (intentional)          | `@mnemopay/sdk/mcp`                             |
| Full SDK (apps only)                    | `@mnemopay/sdk`                                 |

---

## Verifying you're subpath-clean

If your project is itself an MCP server, run:

```bash
node --trace-warnings your-mcp-server.js < /dev/null 2>&1 | head -20
```

If you see `[mnemopay-mcp] Tool filter:` in stderr, somewhere in your dep tree a file does `from "@mnemopay/sdk"` instead of a subpath. `npm ls @mnemopay/sdk` plus a `grep -r "@mnemopay/sdk\"" node_modules/your-package/dist` will find it.
