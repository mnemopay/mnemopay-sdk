/**
 * Loader for the optional `@huggingface/transformers` package (local BGE embeddings and the
 * cross-encoder reranker). It is an optionalDependency: `npm install --omit=optional` skips it
 * (~470 MB with onnxruntime), and nothing else in the SDK needs it.
 */

type Transformers = typeof import("@huggingface/transformers");

export async function loadTransformers(
  feature: string,
  importer: () => Promise<Transformers> = () => import("@huggingface/transformers"),
): Promise<Transformers> {
  try {
    return await importer();
  } catch (e: any) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND") {
      throw new Error(
        `${feature} needs the optional package @huggingface/transformers, which is not installed ` +
          `(it is skipped by npm install --omit=optional). Install it with: npm install @huggingface/transformers`,
      );
    }
    throw e;
  }
}
