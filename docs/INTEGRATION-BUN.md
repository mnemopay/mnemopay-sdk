# INTEGRATION-BUN — install and use `@mnemopay/sdk` under Bun

[Bun](https://bun.sh) runs `@mnemopay/sdk` well: fast installs, native
TypeScript, and clean ESM subpath resolution. The SDK is published as
NodeNext ESM (`"module": "NodeNext"`), which Bun loads directly. The one sharp
edge is the **SQLite persistence backend** — read the [Persistence](#persistence-better-sqlite3-vs-bunsqlite)
section before you wire up the recall store.

Verified against **Bun 1.3.x**.

---

## Install

```bash
bun add @mnemopay/sdk
```

Optional peer backends, only if you use them:

```bash
bun add stripe                       # StripeRail
bun add pg                           # Postgres recall persistence (NeonAdapter)
bun add @huggingface/transformers    # local ONNX embeddings + reranker
```

`zod`, `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` and the LangChain
packages are all optional peers — `bun add` whichever your agent actually
imports.

---

## Usage — subpath imports work out of the box

Follow the [subpath-import rule](./SUBPATH-IMPORT-RULE.md) under Bun exactly as
under Node: import the narrow surface you need, not the package root.

```ts
// recall.ts — run with: bun run recall.ts
import { cosineSimilarity } from "@mnemopay/sdk/recall";
import { CohereMiddleware } from "@mnemopay/sdk/middleware/cohere";
import { MistralMiddleware } from "@mnemopay/sdk/middleware/mistral";
import { StripeRail } from "@mnemopay/sdk/rails";

const a = new Float32Array([1, 0]);
const b = new Float32Array([1, 0]);
console.log(cosineSimilarity(a, b)); // 1
```

The MCP binary works under Bun's package runner too. The package exposes named
bins (`mnemopay-mcp`, `mnemopay-setup`, `mnemopay-dashboard`) — there is no
default command, so invoke the bin by name:

```bash
bunx mnemopay-mcp            # runs the MCP stdio server
# or, after `bun add @mnemopay/sdk`:
bun run mnemopay-mcp
```

---

## Persistence — `better-sqlite3` vs `bun:sqlite`

This is the one thing to get right.

`SQLiteAdapter` / `SQLiteStorage` are backed by **`better-sqlite3`**, a native
N-API addon. As of Bun 1.3.x, `better-sqlite3` is **not yet supported under
Bun** ([oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)).
Constructing the adapter under Bun throws:

```
SQLiteAdapter: failed to open .../memory.db —
'better-sqlite3' is not yet supported in Bun.
... you could try bun:sqlite which has a similar API.
```

You have two clean options:

### Option A — keep SQLite, run that process on Node

If you want `SQLiteAdapter` exactly as-is, run the process that owns the recall
store on Node. Bun is still fine for the rest of your app; only the
SQLite-touching service needs Node. This is the zero-code-change path.

### Option B — use Bun's built-in `bun:sqlite` (no native addon)

Bun ships a SQLite driver in the runtime (`bun:sqlite`) with an API close to
`better-sqlite3` — no native binding to compile, no addon to install. This is
exactly why the [`brain`](https://github.com/mnemopay/brain) repo uses
`bun:sqlite` instead of `better-sqlite3`: it sidesteps native-binding setup
entirely. Point your store at `bun:sqlite` by providing a small adapter that
implements the same `PersistenceAdapter` surface as
`src/recall/persistence/sqlite.ts`, backed by:

```ts
import { Database } from "bun:sqlite";
const db = new Database("memory.db"); // or ":memory:"
```

The table shape is identical to `SQLiteAdapter` (`memory_rows(agent_id, id,
content, embedding BLOB, metadata, created_at)`), so a `bun:sqlite`-backed
adapter is a drop-in once it implements the `PersistenceAdapter` surface
(`set` / `get` / `delete` / `search` / `close`).

### What works on Bun without any of this

| Backend | Bun status |
| --- | --- |
| In-memory recall (no persistence) | ✅ works |
| `NeonAdapter` / Postgres (`pg`) | ✅ works — `pg` is pure JS |
| `@huggingface/transformers` embeddings | ✅ works (downloads ONNX model on first run) |
| `SQLiteAdapter` (`better-sqlite3`) | ❌ blocked by bun#4290 — use Option A or B |

For most production Bun deployments, **Postgres via `NeonAdapter` is the path
of least resistance** — it has no native dependency and works identically on
Node and Bun.

---

## Smoke test

```bash
bun add @mnemopay/sdk
cat > smoke.ts <<'EOF'
import { cosineSimilarity } from "@mnemopay/sdk/recall";
import { CohereMiddleware } from "@mnemopay/sdk/middleware/cohere";
const a = new Float32Array([1, 0]);
const b = new Float32Array([1, 0]);
console.log("cosine:", cosineSimilarity(a, b));          // 1
console.log("wrap:", typeof CohereMiddleware.wrap);       // function
EOF
bun run smoke.ts
```

Expected output:

```
cosine: 1
wrap: function
```
