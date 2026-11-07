/**
 * Agent ids become file and directory names on disk (`<dir>/<id>.json`,
 * `<dir>/agent-<id>/`). An id such as `../../app/package` would otherwise
 * escape the data dir (audit D2), so every id is mapped to a name that cannot
 * contain a path separator or `..`.
 *
 * Ordinary ids (letters, digits, `. _ : @ -`, no `..`, not starting with `.`)
 * are returned unchanged, so existing persisted files keep their names.
 * Anything else is replaced by a readable sanitised prefix plus a SHA-256 of
 * the original id, which keeps distinct ids distinct.
 *
 * Browser-safe: `crypto` is only required on the unsafe-id path, which only
 * runs where a filesystem exists.
 */
const SAFE_ID = /^[A-Za-z0-9_:@-][A-Za-z0-9._:@-]{0,199}$/;

export function safeFileId(agentId: string): string {
  const id = String(agentId);
  if (SAFE_ID.test(id) && !id.includes("..")) return id;
  const { createHash } = require("crypto") as typeof import("crypto");
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 24);
  const prefix = id.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `${prefix || "id"}-${digest}`;
}
