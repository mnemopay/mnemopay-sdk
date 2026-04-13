import { sha256 } from '@noble/hashes/sha256';

export function embed(text: string, embeddingDim: number = 384): Float32Array {
  const hash = sha256(Buffer.from(text, 'utf8'));
  const vec = new Float32Array(embeddingDim);
  for (let i = 0; i < embeddingDim; i++) {
    vec[i] = (hash[i % 32] / 127.5) - 1.0;
  }
  // L2 normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}
