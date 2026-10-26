/**
 * Concurrent-writer persistence safety.
 *
 * One persist file is shared by every process that constructs a MnemoPayLite
 * for the same agentId (each MCP server instance does). `_loadFromDisk()` runs
 * once at construction while `_saveToDisk()` writes the instance's FULL state,
 * so before the merge fix a second instance's save erased every memory the
 * first stored after that load — and the next save copied the emptied file
 * over `.bak`, taking the backup with it.
 *
 * Regression for real data loss: three memories stored 2026-10-22 were
 * acknowledged as `{"status":"stored"}`, written to disk, then overwritten by
 * an idle instance's 30s auto-save. All copies (main + .bak) were empty.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MnemoPay, MnemoPayLite } from "../src/index.js";

const AGENT = "concurrent-persist-test";

let dir: string;
const live: MnemoPayLite[] = [];

/** A fresh instance on the shared dir — stands in for another process. */
function spawnInstance(): MnemoPayLite {
  const agent = MnemoPay.quick(AGENT);
  agent.enablePersistence(dir);
  live.push(agent);
  return agent;
}

function readStored(): any {
  return JSON.parse(fs.readFileSync(path.join(dir, `${AGENT}.json`), "utf-8"));
}

function storedContents(): string[] {
  return (readStored().memories as any[]).map((m) => m.content).sort();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemopay-concurrent-"));
});

afterEach(() => {
  // destroy() clears the 30s auto-save timer so vitest can exit.
  while (live.length) live.pop()!.destroy();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("concurrent writers on one persist file", () => {
  it("does not erase memories a second instance stored after this one loaded", async () => {
    const a = spawnInstance();
    await a.remember("written by A before B started");

    // B loads now — its snapshot contains A's first memory only.
    const b = spawnInstance();

    // A keeps working after B's load. B knows nothing about this one.
    await a.remember("written by A after B loaded");

    // B saves its full state. Before the fix this wrote B's stale snapshot
    // and the second A memory was gone for good.
    await b.remember("written by B");

    expect(storedContents()).toEqual([
      "written by A after B loaded",
      "written by A before B started",
      "written by B",
    ]);
  });

  it("survives the idle-instance auto-save that caused the 2026-10-22 loss", async () => {
    // The idle instance: constructed, then never used again.
    const idle = spawnInstance();

    const busy = spawnInstance();
    await busy.remember("the session's real work");

    // Exactly what the 30s timer does on the idle instance.
    (idle as any)._saveToDisk();

    expect(storedContents()).toEqual(["the session's real work"]);
  });

  it("keeps the .bak copy usable instead of overwriting it with an empty state", async () => {
    const idle = spawnInstance();
    const busy = spawnInstance();
    await busy.remember("must survive two idle saves");

    // Two saves: the first rotates main → .bak, the second would previously
    // copy the already-emptied main over the backup.
    (idle as any)._saveToDisk();
    (idle as any)._saveToDisk();

    const bak = JSON.parse(
      fs.readFileSync(path.join(dir, `${AGENT}.json.bak`), "utf-8"),
    );
    expect(bak.memories.map((m: any) => m.content)).toContain(
      "must survive two idle saves",
    );
  });

  it("does not resurrect a memory this instance forgot", async () => {
    const a = spawnInstance();
    const doomed = await a.remember("deliberately forgotten");
    await a.remember("kept");

    // B loads while both memories exist, so its snapshot still holds the
    // doomed one.
    const b = spawnInstance();

    await a.forget(doomed);
    expect(storedContents()).toEqual(["kept"]);

    // B's save must not merge the deletion back in from its stale copy.
    await b.remember("added by B");
    expect(storedContents()).toEqual(["added by B", "kept"]);
  });

  it("does not resurrect memories dropped by consolidate()", async () => {
    const a = spawnInstance();
    // importance 0 + no access decays below the 0.01 consolidate threshold.
    const stale = await a.remember("stale memory", { importance: 0 });
    (a as any).memories.get(stale).lastAccessed = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    await a.remember("fresh memory", { importance: 1 });

    const b = spawnInstance();

    const pruned = await a.consolidate();
    expect(pruned).toBe(1);

    await b.remember("added by B");
    expect(storedContents()).toEqual(["added by B", "fresh memory"]);
  });

  it("ignores a persist file belonging to a different agent", async () => {
    const a = spawnInstance();
    await a.remember("mine");

    // Hand-write a foreign file at our path.
    const p = path.join(dir, `${AGENT}.json`);
    const foreign = { ...readStored(), agentId: "someone-else", memories: [
      { id: "foreign-1", agentId: "someone-else", content: "not mine", importance: 1,
        score: 1, createdAt: new Date().toISOString(), lastAccessed: new Date().toISOString(),
        accessCount: 0, tags: [] },
    ] };
    fs.writeFileSync(p, JSON.stringify(foreign), "utf-8");

    await a.remember("also mine");
    expect(storedContents()).toEqual(["also mine", "mine"]);
  });

  it("still saves when the existing file is corrupt", async () => {
    const a = spawnInstance();
    await a.remember("before corruption");

    fs.writeFileSync(path.join(dir, `${AGENT}.json`), "{ this is not json", "utf-8");

    // The merge must swallow the parse error rather than block the write.
    await a.remember("after corruption");
    expect(storedContents()).toEqual(["after corruption", "before corruption"]);
  });
});
