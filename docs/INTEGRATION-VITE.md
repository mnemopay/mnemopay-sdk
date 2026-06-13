# INTEGRATION-VITE — bundling `@mnemopay/sdk` for the browser with Vite

MnemoPay's recall engine ships with Node-only optional backends — local ONNX
embeddings (`@huggingface/transformers`), SQLite persistence
(`better-sqlite3`), and Postgres persistence (`pg`). They are loaded through
**dynamic `import()` / `require()`** so they never run in a browser, but Vite's
dependency optimizer (esbuild) and Rollup still try to *resolve* them at build
time. On a browser target that fails the build with errors like:

```
[vite]: Rollup failed to resolve import "better-sqlite3" from
"node_modules/@mnemopay/sdk/dist/recall/persistence/sqlite.js".
Could not load .../onnxruntime-node ... (imported by @huggingface/transformers)
```

The fix is to stub those Node-only backends out of the browser bundle. With
the config below, the Forge integration dropped its bundle from **820 KB →
57 KB** — the heavy ML/SQL backends never ship to the client.

> You only need this if you import a MnemoPay surface that *reaches* the recall
> persistence/embedder graph in browser code (e.g. `@mnemopay/sdk/recall`). The
> pure-client surfaces (`@mnemopay/sdk/client`, the rails types, identity
> verification) don't pull these in.

---

## `vite.config.ts`

```ts
import { defineConfig } from "vite";

// Node-only optional backends inside @mnemopay/sdk. They are dynamically
// imported at runtime under Node, so stubbing them for the browser is safe —
// browser code paths never hit them.
const NODE_ONLY = [
  "better-sqlite3",
  "pg",
  "@huggingface/transformers",
  // transformers' native ORT backend; only @huggingface/transformers pulls it.
  "onnxruntime-node",
];

export default defineConfig({
  resolve: {
    alias: NODE_ONLY.map((find) => ({
      find,
      // An empty module — imports resolve to `{}` and tree-shake away.
      replacement: new URL("./src/empty-module.js", import.meta.url).pathname,
    })),
  },
  optimizeDeps: {
    // Keep esbuild's pre-bundle step from trying to crawl them.
    exclude: NODE_ONLY,
  },
  build: {
    rollupOptions: {
      // Belt-and-suspenders: if anything still references them, don't fail.
      external: NODE_ONLY,
    },
  },
});
```

Create the stub once:

```js
// src/empty-module.js
export default {};
```

If you prefer not to add a file, use the `vite-plugin-node-polyfills` /
`rollup-plugin-node-resolve` `false` trick instead — but a one-line empty
module is the most portable.

---

## Why each knob

| Knob | What it prevents |
| --- | --- |
| `resolve.alias` | Rollup's static-import resolution failing on the missing native module. |
| `optimizeDeps.exclude` | esbuild's dev pre-bundling from crawling the native dep and erroring on `.node` binaries. |
| `build.rollupOptions.external` | A fallback so a stray reference is treated as external rather than a hard failure. |

---

## Smoke test — verify the bundle compiles

```bash
# from your app root, after adding the config above
npm run build

# 1. Build must succeed with no "failed to resolve" errors.
# 2. Confirm the native backends are NOT in the client bundle:
grep -rl "better-sqlite3\|onnxruntime-node" dist/ && echo "LEAKED" || echo "clean"
#   -> expect: clean
```

For a runtime check, import a browser-safe surface and confirm it loads:

```ts
// works in the browser — no native backend touched
import { cosineSimilarity } from "@mnemopay/sdk/recall";
const a = new Float32Array([1, 0]);
const b = new Float32Array([1, 0]);
console.log(cosineSimilarity(a, b)); // 1
```

If you instead need real embeddings in the browser, swap the local ONNX
embedder for a remote embedding API (OpenAI / Cohere `embed`) and pass the
vectors in directly — don't ship `@huggingface/transformers` to the client.
