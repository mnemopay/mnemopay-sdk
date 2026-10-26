/**
 * @mnemopay/sdk — governance module barrel.
 *
 * The governance module provides FiscalGate (charter-driven budget enforcement)
 * and Article 12 (EU AI Act audit bundle export) primitives. Folded from
 * praetor/packages/{core,payments} on 2026-05-06.
 *
 * Usage:
 *   import { runMission, validateCharter, MerkleAudit, buildArticle12Bundle, MockPayments } from "@mnemopay/sdk";
 */

export { MerkleAudit } from "./audit.js";
export type { AuditEvent, AuditListener } from "./audit.js";

export { validateCharter } from "./charter.js";
export type { Charter, CharterBudget, CharterAgent, CharterStep, CharterRole } from "./charter.js";

export { runMission } from "./runtime.js";
export type { MissionResult, MissionContext } from "./runtime.js";

export { buildArticle12Bundle } from "./article12.js";
export type { Article12Bundle, Article12BundleFile, Article12BundleInput } from "./article12.js";

export { MockPayments } from "./payments.js";
export type { PaymentsAdapter } from "./payments.js";

export { attachSpatialEvidence, verifySpatialEvidence, fingerprintSpatialEvidence } from "./spatial.js";
export type {
  SpatialEvidence,
  SpatialEvidenceVerifyResult,
  SpatialEvidenceRejectReason,
  GridStampSpatialProof,
  GridStampSplatEvidence,
} from "./spatial.js";

// Sub-second policy enforcement (EU AI Act + sector rules).
export {
  compilePolicy,
  evaluateAction,
  InMemoryRateCounter,
} from "./policy.js";
export type {
  Policy,
  PolicyRule,
  PolicyAction,
  PolicyVerdict,
  CompiledPolicy,
  EvaluateOptions,
  RateWindow,
} from "./policy.js";

export { lintPolicy } from "./policy-lint.js";
export type { LintIssue, LintReport } from "./policy-lint.js";

export { defaultEuAiActPolicy, EU_AI_ACT_POLICY_V1 } from "./policies/eu-ai-act.js";

export { InMemoryApprovalStore, routeVerdict } from "./approval.js";
export type {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStore,
} from "./approval.js";

export type { RateCounter, RateCounterAdapter } from "./rate-counter.js";

// Shared event-stream audit chain — used by mnemopay-code, mnemopay-browser,
// and the MCP Gateway for Article 12 bundle export.
export {
  AuditChain,
  verifyBundle,
  canonicalize as canonicalizeJson,
  sha256Hex,
} from "./audit-chain.js";
export type {
  ChainEvent,
  ChainBundle,
  ChainSinkOptions,
  VerifyBundleOptions,
} from "./audit-chain.js";

// On-chain anchoring seam for AuditChain bundles. Interface + mock only — an
// anchoring provider implements OnChainAnchorSink in their own package and is
// injected, so the SDK core carries no chain code, ABI, address or gas handling.
export {
  anchorChainBundle,
  attachAnchorReference,
  pollAnchor,
  MockAnchorSink,
  ANCHOR_META_KEY,
} from "./anchor-sink.js";
export type {
  OnChainAnchorSink,
  AnchorRequest,
  AnchorHandle,
  AnchorReference,
  AnchorStatus,
  PollAnchorOptions,
} from "./anchor-sink.js";

// MnemoGuard risk taxonomy — default action→tier ladder + ready-made preset.
export {
  RISK_ORDER,
  riskRank,
  classifyRisk,
  buildRiskPolicy,
} from "./risk.js";
export type { RiskLevel, RiskAssessment, RiskPolicyOptions } from "./risk.js";

// Typed agent action ledger — structured "what did the agent do" record.
export { ActionLedger } from "./action-ledger.js";
export type {
  ActionStatus,
  ActionApproval,
  AgentActionRecord,
  BeginActionInput,
  ActionUpdate,
} from "./action-ledger.js";
