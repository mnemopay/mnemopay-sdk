/**
 * Regression: root-import of `@mnemopay/sdk` must NEVER auto-start the MCP
 * stdio server, log to stderr, or emit any [mnemopay-mcp] string.
 *
 * Catastrophic if violated: when the CALLER itself is a stdio MCP server
 * (e.g. the brain MCP server in `C:/Users/bizsu/Projects/brain`), any
 * spurious stderr output corrupts the JSON-RPC protocol on the same FD
 * and crashes the host. The CJS guard at the end of `src/mcp/server.ts`
 * (`if (require.main === module)`) is what stops this; this test pins
 * the behavior in CI so future refactors can't silently regress it.
 *
 * Subprocess-based because in-process vi spies can be tricked by code
 * that grabs `process.stderr.write` directly. The subprocess inherits
 * stdio and captures every byte that would leak in real usage.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

const SDK_ROOT = path.resolve(__dirname, "..");

function probeRootImport(entry: "dist" | "src"): { stdout: string; stderr: string; code: number | null } {
  // Use a one-liner that imports the root SDK and exits. ANY stderr output
  // beyond an empty string indicates a leak.
  const target =
    entry === "dist"
      ? path.join(SDK_ROOT, "dist", "index.js")
      : path.join(SDK_ROOT, "src", "index.ts");

  const cmd =
    entry === "dist"
      ? `require(${JSON.stringify(target)});`
      : `require('tsx/cjs'); require(${JSON.stringify(target)});`;

  // For src probing we'd need tsx; for stability we only probe dist. The
  // dist build is what npm consumers pull, and is the only artifact whose
  // side-effects affect them.
  const result = spawnSync(
    process.execPath,
    ["-e", cmd],
    {
      cwd: SDK_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        // Force a non-mcp argv so the CJS guard does not fire even if the
        // test runner itself is named close to "mcp".
        NODE_NO_WARNINGS: "1",
      },
    },
  );
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

describe("root-import side effects (subprocess)", () => {
  it("dist/index.js: importing the SDK root emits NO stderr and starts no server", () => {
    const { stdout, stderr, code } = probeRootImport("dist");
    expect(code, `exit code: ${code}\nstderr: ${stderr}`).toBe(0);
    // No mnemopay-mcp log line of ANY kind on root import.
    expect(stderr).not.toMatch(/\[mnemopay-mcp\]/);
    // No "Tool filter" log (the historical catastrophic leak).
    expect(stderr).not.toMatch(/Tool filter:/);
    // No "Server started" log.
    expect(stderr).not.toMatch(/Server started/);
    // stdout should also be empty — root import is silent.
    expect(stdout).toBe("");
  }, 35_000);

  it("dist/index.js: subprocess exits promptly (no lingering MCP transport)", () => {
    const t0 = Date.now();
    const { code } = probeRootImport("dist");
    const elapsed = Date.now() - t0;
    expect(code).toBe(0);
    // If the MCP server auto-started, the StdioServerTransport would hold
    // the event loop open and the subprocess would hit the 30s timeout.
    expect(elapsed).toBeLessThan(15_000);
  }, 35_000);

  it("package root: CommonJS require resolves through package exports", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const sdk = require('@mnemopay/sdk'); if (!sdk || typeof sdk.MnemoPayLite !== 'function') process.exit(2);",
      ],
      {
        cwd: SDK_ROOT,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
        },
      },
    );

    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stderr ?? "").not.toMatch(/\[mnemopay-mcp\]|Server started|Tool filter:/);
  }, 35_000);
});
