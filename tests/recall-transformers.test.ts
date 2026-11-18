import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { loadTransformers } from "../src/recall/transformers.js";

describe("optional @huggingface/transformers", () => {
  it("is an optionalDependency, not a dependency (npm install --omit=optional skips ~470 MB)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies["@huggingface/transformers"]).toBeUndefined();
    expect(pkg.optionalDependencies["@huggingface/transformers"]).toBeTruthy();
  });

  it("CONTROL: when installed, the real package loads", async () => {
    const t = await loadTransformers("test");
    expect(typeof t.pipeline).toBe("function");
  });

  it("when missing, the error names the feature and how to install it", async () => {
    const missing = () => Promise.reject(Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" }));
    await expect(loadTransformers('embeddingProvider "bge"', missing)).rejects.toThrow(
      /embeddingProvider "bge" needs the optional package @huggingface\/transformers.*npm install @huggingface\/transformers/,
    );
  });

  it("other load errors are passed through unchanged", async () => {
    const broken = () => Promise.reject(new Error("onnxruntime binding failed"));
    await expect(loadTransformers("x", broken)).rejects.toThrow("onnxruntime binding failed");
  });
});
