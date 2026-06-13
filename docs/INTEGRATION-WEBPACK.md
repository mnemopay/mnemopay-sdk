# INTEGRATION-WEBPACK — bundling `@mnemopay/sdk` for the browser with Webpack

MnemoPay's recall engine ships with Node-only optional backends — local ONNX
embeddings (`@huggingface/transformers`), SQLite persistence
(`better-sqlite3`), and Postgres persistence (`pg`). They are loaded through
**dynamic `import()` / `require()`** so they never run in a browser, but
Webpack still tries to *resolve* and bundle them for a `web` target. On a
browser build that surfaces as:

```
Module not found: Error: Can't resolve 'better-sqlite3'
Module not found: Error: Can't resolve 'pg'
Module parse failed: Unexpected character ... (onnxruntime-node/*.node)
```

The fix is to alias those Node-only backends to `false` so Webpack emits an
empty module for them. With this config the heavy ML/SQL backends are excluded
from the client bundle (the same change that took the Forge integration from
**820 KB → 57 KB** under Vite).

> You only need this if your *browser* code imports a MnemoPay surface that
> reaches the recall persistence/embedder graph (e.g. `@mnemopay/sdk/recall`).
> Pure-client surfaces (`@mnemopay/sdk/client`, identity verification) don't.

---

## `webpack.config.js`

```js
// Node-only optional backends inside @mnemopay/sdk. Safe to stub for the
// browser — these code paths are dynamic-imported and only run under Node.
const NODE_ONLY = [
  "better-sqlite3",
  "pg",
  "@huggingface/transformers",
  "onnxruntime-node",
];

module.exports = {
  target: "web",
  resolve: {
    alias: Object.fromEntries(NODE_ONLY.map((name) => [name, false])),
    // Webpack 5 dropped automatic Node core-module polyfills. The recall
    // engine references a few; map the ones you actually hit to false too.
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      os: false,
    },
  },
  // Optional: keep them out of the graph entirely if they're only referenced
  // from server bundles you build separately.
  externals: {
    "better-sqlite3": "commonjs better-sqlite3",
    pg: "commonjs pg",
  },
};
```

`alias: { <pkg>: false }` is the canonical Webpack 5 way to resolve a module to
an empty stub — no extra placeholder file needed (unlike Vite, which wants a
real empty module).

---

## Why each knob

| Knob | What it prevents |
| --- | --- |
| `resolve.alias.<pkg> = false` | "Can't resolve 'better-sqlite3'/'pg'" and the `.node` binary parse error from `onnxruntime-node`. |
| `resolve.fallback` | Webpack-5 "Module not found" for Node core modules (`fs`, `path`, …) that the engine references but never executes in the browser. |
| `externals` | (server bundles only) leaves the native deps as runtime `require`s instead of bundling them. Omit for a pure browser build. |

---

## Smoke test — verify the bundle compiles

```bash
# from your app root
npx webpack --mode production

# 1. Build must finish with no "Can't resolve" errors.
# 2. Confirm the native backends did not leak into the client bundle:
grep -rl "better-sqlite3\|onnxruntime-node" dist/ && echo "LEAKED" || echo "clean"
#   -> expect: clean
```

Runtime check with a browser-safe surface:

```ts
import { cosineSimilarity } from "@mnemopay/sdk/recall";
const a = new Float32Array([1, 0]);
const b = new Float32Array([1, 0]);
console.log(cosineSimilarity(a, b)); // 1
```

Need real embeddings client-side? Call a remote embedding API (OpenAI / Cohere
`embed`) and pass the vectors in — don't ship `@huggingface/transformers` to
the browser.
