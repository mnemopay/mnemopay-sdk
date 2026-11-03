/**
 * Regression: a script that creates a persistent agent, uses it, and reaches the
 * end of the file must exit by itself. The 30s autosave interval used to keep the
 * event loop alive forever, so every demo/quick-start hung until Ctrl+C.
 *
 * Subprocess against the built dist (what npm consumers run), with its own
 * temp persistence dir so the test never touches ~/.mnemopay.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const DIST = path.resolve(__dirname, "..", "dist", "index.js");

describe("process lifecycle", () => {
  it("a persistent agent does not keep the process alive", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-exit-"));
    const code = `
      const { MnemoPay } = require(${JSON.stringify(DIST)});
      (async () => {
        const a = MnemoPay.quick("exit-test");
        await a.remember("persists and still exits");
        console.log("done");
      })();
    `;
    // The SDK turns persistence off when VITEST / NODE_ENV=test is set, so scrub them for the child.
    const env: NodeJS.ProcessEnv = { ...process.env, MNEMOPAY_PERSIST_DIR: dir };
    delete env.VITEST;
    delete env.NODE_ENV;
    const r = spawnSync(process.execPath, ["-e", code], {
      env,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.error).toBeUndefined(); // a timeout surfaces as r.error (ETIMEDOUT)
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("done");
    // and the memory was flushed to disk before exit
    const saved = fs.readFileSync(path.join(dir, "exit-test.json"), "utf8");
    expect(saved).toContain("persists and still exits");
    fs.rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
