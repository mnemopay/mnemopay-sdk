import { mkdir, writeFile } from "node:fs/promises";
import {
  MerkleAudit,
  buildArticle12Bundle,
  validateCharter,
} from "../dist/governance/index.js";

const charter = validateCharter({
  name: "vendor-invoice-agent",
  goal: "Review and approve a software invoice within policy.",
  budget: { maxUsd: 500, approvalThresholdUsd: 100 },
  agents: [{ role: "auditor", model: "gpt-5" }],
  outputs: ["invoice-decision.json"],
  compliance: { article12: true },
});

const audit = new MerkleAudit();
const startedAt = new Date().toISOString();
audit.record("mission.start", { charter: charter.name, budget: charter.budget });
audit.record("tool.call", { tool: "vendor.lookup", vendorId: "vendor_demo_42" });
audit.record("policy.decision", {
  allowed: false,
  reason: "human approval required above $100",
  amountUsd: 249,
});
audit.record("approval.requested", { approverRole: "finance_manager", amountUsd: 249 });
audit.record("approval.granted", { approverRole: "finance_manager", amountUsd: 249 });
audit.record("payment.authorized", { amountUsd: 249, rail: "demo" });
audit.record("mission.complete", { outputs: 1, spentUsd: 249 });

const result = {
  charterName: charter.name,
  status: "ok",
  spentUsd: 249,
  outputs: ["invoice-decision.json"],
  auditDigest: audit.finalize(),
  startedAt,
  finishedAt: new Date().toISOString(),
};

const bundle = buildArticle12Bundle({
  charter,
  result,
  audit,
  retentionMonths: 6,
  operatorId: "sample-design-partner",
});

const out = new URL("../../mnemopay-site/proof/sample-article12-bundle/", import.meta.url);
await mkdir(out, { recursive: true });
for (const file of bundle.files) {
  await writeFile(new URL(file.path, out), file.body);
}
await writeFile(
  new URL("bundle.json", out),
  JSON.stringify(bundle, null, 2),
);
await writeFile(
  new URL("../sample-article12-bundle.json", out),
  JSON.stringify(bundle, null, 2),
);
console.log(`Sample Article 12 bundle: ${bundle.bundleSha256}`);
