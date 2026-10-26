/**
 * On-chain anchoring seam — interface-level tests only.
 *
 * Every test drives an injected MockAnchorSink. There is no RPC, no contract
 * address and no chain dependency anywhere in this file, which is the whole
 * point of the seam: an anchoring provider implements OnChainAnchorSink in
 * their own package, and the SDK never learns what chain they used.
 */
import { describe, it, expect } from "vitest";
import {
  AuditChain,
  verifyBundle,
  anchorChainBundle,
  attachAnchorReference,
  pollAnchor,
  MockAnchorSink,
  ANCHOR_META_KEY,
  type AnchorReference,
  type AnchorStatus,
  type OnChainAnchorSink,
} from "../../src/governance/index.js";

function sealedBundle(events = 3) {
  const chain = new AuditChain();
  for (let i = 0; i < events; i++) {
    chain.emit("llm.call", { i });
  }
  return chain.toBundle({ producer: "test-suite" });
}

/** No-sleep poller so tests never touch real timers. */
const noSleep = () => Promise.resolve();

describe("anchorChainBundle", () => {
  it("hands the sink the bundle's root, meta and seal time verbatim", async () => {
    const bundle = sealedBundle();
    const sink = new MockAnchorSink();

    const handle = await anchorChainBundle(bundle, sink, { producerId: "mnemopay/test" });

    expect(handle.anchorId).toBeTruthy();
    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0]).toEqual({
      producerId: "mnemopay/test",
      merkleRoot: bundle.merkle_root,
      bundleMeta: bundle.meta,
      sealedAt: bundle.built_at,
    });
  });

  it("never hands raw events to the sink", async () => {
    const bundle = sealedBundle();
    const sink = new MockAnchorSink();

    await anchorChainBundle(bundle, sink, { producerId: "p" });

    expect(Object.keys(sink.requests[0]!)).not.toContain("events");
    expect(JSON.stringify(sink.requests[0])).not.toContain("llm.call");
  });

  it("refuses to anchor an empty root rather than attesting to nothing", async () => {
    const empty = new AuditChain().toBundle();
    expect(empty.merkle_root).toBe("");
    const sink = new MockAnchorSink();

    await expect(anchorChainBundle(empty, sink, { producerId: "p" })).rejects.toThrow(
      /empty merkle_root/,
    );
    expect(sink.requests).toHaveLength(0);
  });

  it("requires a producerId so anchors cannot collide across producers", async () => {
    const sink = new MockAnchorSink();
    await expect(
      anchorChainBundle(sealedBundle(), sink, { producerId: "" }),
    ).rejects.toThrow(/producerId is required/);
  });
});

describe("attachAnchorReference", () => {
  const ref: AnchorReference = {
    chain: "somechain",
    txHash: "0xabc",
    rootCommitment: "0xroot",
  };

  it("does NOT invalidate the merkle root — the bundle still verifies", () => {
    const bundle = sealedBundle(5);
    expect(verifyBundle(bundle)).toEqual({ ok: true });

    const anchored = attachAnchorReference(bundle, ref);

    // The root is rolled over events only, so metadata is free to grow.
    expect(anchored.merkle_root).toBe(bundle.merkle_root);
    expect(verifyBundle(anchored)).toEqual({ ok: true });
    expect(anchored.meta[ANCHOR_META_KEY]).toEqual(ref);
  });

  it("survives a JSON round-trip with the root intact", () => {
    const anchored = attachAnchorReference(sealedBundle(4), ref);
    const reparsed = JSON.parse(JSON.stringify(anchored));

    expect(verifyBundle(reparsed)).toEqual({ ok: true });
    expect(reparsed.meta.anchor).toEqual(ref);
  });

  it("does not mutate the original bundle", () => {
    const bundle = sealedBundle();
    attachAnchorReference(bundle, ref);
    expect(ANCHOR_META_KEY in bundle.meta).toBe(false);
  });

  it("refuses to silently replace an existing anchor", () => {
    const anchored = attachAnchorReference(sealedBundle(), ref);
    expect(() =>
      attachAnchorReference(anchored, { ...ref, txHash: "0xdifferent" }),
    ).toThrow(/already set/);
  });

  it("preserves unrelated meta keys", () => {
    const chain = new AuditChain();
    chain.emit("e", {});
    const bundle = chain.toBundle({ producer: "acme", jurisdiction: "EU" });

    const anchored = attachAnchorReference(bundle, ref);

    expect(anchored.meta.producer).toBe("acme");
    expect(anchored.meta.jurisdiction).toBe("EU");
  });
});

describe("pollAnchor", () => {
  it("resolves pending → anchored and returns the reference", async () => {
    const sink = new MockAnchorSink({ pendingTicks: 2 });
    const bundle = sealedBundle();
    const { anchorId } = await anchorChainBundle(bundle, sink, { producerId: "p" });

    const status = await pollAnchor(sink, anchorId, { attempts: 5, sleep: noSleep });

    expect(status.state).toBe("anchored");
    if (status.state === "anchored") {
      // The sink commits the same root it was handed.
      expect(status.rootCommitment).toBe(bundle.merkle_root);
      expect(status.chain).toBe("mock");
    }
  });

  it("returns the terminal failure instead of throwing", async () => {
    const sink = new MockAnchorSink({ failWith: "insufficient gas" });
    const { anchorId } = await anchorChainBundle(sealedBundle(), sink, { producerId: "p" });

    const status = await pollAnchor(sink, anchorId, { attempts: 3, sleep: noSleep });

    expect(status).toEqual({ state: "failed", reason: "insufficient gas" });
  });

  it("gives back 'pending' when attempts run out, distinguishable from failure", async () => {
    const sink = new MockAnchorSink({ pendingTicks: 99 });
    const { anchorId } = await anchorChainBundle(sealedBundle(), sink, { producerId: "p" });

    const status = await pollAnchor(sink, anchorId, { attempts: 3, sleep: noSleep });

    expect(status).toEqual({ state: "pending" });
  });

  it("stops polling as soon as the anchor resolves", async () => {
    let calls = 0;
    const counting: OnChainAnchorSink = {
      anchor: async () => ({ anchorId: "a1" }),
      status: async (): Promise<AnchorStatus> => {
        calls++;
        return { state: "anchored", chain: "c", txHash: "t", rootCommitment: "r" };
      },
    };

    await pollAnchor(counting, "a1", { attempts: 10, sleep: noSleep });

    expect(calls).toBe(1);
  });

  it("treats an unknown handle as failed, not as an exception", async () => {
    const sink = new MockAnchorSink();
    const status = await pollAnchor(sink, "never-issued", { attempts: 1, sleep: noSleep });
    expect(status.state).toBe("failed");
  });
});

describe("seal → anchor → attach → verify, end to end", () => {
  it("round-trips through a provider-agnostic sink", async () => {
    const chain = new AuditChain();
    chain.emit("mission.start", { charter: "c1" });
    chain.emit("payment.settled", { amount: 42 });
    chain.emit("mission.end", { ok: true });

    const sealed = chain.toBundle({ producer: "mnemopay/sdk" });
    const sink = new MockAnchorSink({ pendingTicks: 1 });

    const { anchorId } = await anchorChainBundle(sealed, sink, { producerId: "mnemopay/sdk" });
    const status = await pollAnchor(sink, anchorId, { sleep: noSleep });
    expect(status.state).toBe("anchored");
    if (status.state !== "anchored") return;

    const final = attachAnchorReference(sealed, {
      chain: status.chain,
      txHash: status.txHash,
      rootCommitment: status.rootCommitment,
    });

    // Article 12 record-keeping stays intact; the anchor is extra evidence.
    expect(verifyBundle(final)).toEqual({ ok: true });
    expect(final.events).toHaveLength(3);
    expect(final.meta.anchor.rootCommitment).toBe(sealed.merkle_root);
  });
});
