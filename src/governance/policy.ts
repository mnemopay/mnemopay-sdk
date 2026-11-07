/**
 * @mnemopay/sdk — sub-second policy enforcement.
 *
 * `evaluateAction()` answers "is this agent action allowed right now?" in
 * O(rules + 1) with regex caching. Sync, no I/O, no LLM. Compiles each
 * `Policy` once to a `CompiledPolicy` for hot-path use; the compiled form
 * is the only structure on the evaluation path.
 *
 * Designed for the EU AI Act August 2 enforcement timer: every tool call,
 * LLM call, or external request can flow through `evaluateAction()` with
 * micro-second-level overhead per check, leaving headroom for the rest of
 * the agent loop.
 *
 * Pure module — depends on nothing inside @mnemopay/sdk.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type PolicyVerdict =
  | { allowed: true; matched_rules: readonly string[]; latency_ns: number }
  | { allowed: false; reason: string; matched_rule: string; latency_ns: number }
  | { needs_approval: true; reason: string; matched_rule: string; latency_ns: number };

export interface PolicyAction {
  /** What the agent wants to do. Free-form, but keep it short for the regex caches. */
  kind: "tool_call" | "llm_call" | "http_request" | "file_write" | "payment";
  /** Identifier of the specific tool/model/endpoint/path. */
  target: string;
  /** Estimated USD cost of this action (0 for no-cost actions). */
  estimated_usd?: number;
  /** Free-form args (e.g. tool input) — matched against `arg_pattern_blocks`. */
  args_text?: string;
  /** ISO 2-letter locale (e.g. "US", "DE", "NG"). Drives EU AI Act geo rules. */
  locale?: string;
  /** Wallclock when the action was attempted; defaults to now(). */
  at?: Date;
}

export type RateWindow = "second" | "minute" | "hour";

export interface PolicyRule {
  /** Stable identifier — appears in matched_rules / matched_rule. */
  id: string;
  /** Optional human-friendly description. */
  description?: string;
  /** Which action kinds this rule applies to. Empty/undefined = all. */
  applies_to?: ReadonlyArray<PolicyAction["kind"]>;
  /** Target exact-match. */
  target_in?: ReadonlyArray<string>;
  /** Target glob/regex (compiled once at policy-compile time). */
  target_pattern?: string;
  /** Block if action.args_text matches this pattern. */
  arg_pattern_blocks?: string;
  /** Block if action.locale is in this list. */
  block_locales?: ReadonlyArray<string>;
  /** Block unless action.locale is in this list. */
  allow_only_locales?: ReadonlyArray<string>;
  /** Block if estimated_usd > this. */
  hard_cap_usd?: number;
  /** Trigger needs_approval if estimated_usd > this. */
  approval_threshold_usd?: number;
  /** Rate limit. Counts actions of matching kind+target inside the window. */
  rate_limit?: {
    window: RateWindow;
    max: number;
  };
  /** If true and the rule matches at all, return `allowed: false`. */
  outright_block?: boolean;
}

export interface Policy {
  /** Used for log lines + audit chain. Versioned. */
  id: string;
  version: number;
  rules: readonly PolicyRule[];
}

interface CompiledRule {
  raw: PolicyRule;
  target_pattern_re: RegExp | null;
  arg_pattern_re: RegExp | null;
  target_in_set: Set<string> | null;
  block_locales_set: Set<string> | null;
  allow_only_locales_set: Set<string> | null;
  applies_to_set: Set<PolicyAction["kind"]> | null;
}

export interface CompiledPolicy {
  policy: Policy;
  rules: readonly CompiledRule[];
}

// ─── Compile ────────────────────────────────────────────────────────────────

export function compilePolicy(policy: Policy): CompiledPolicy {
  const rules = policy.rules.map((rule): CompiledRule => ({
    raw: rule,
    target_pattern_re: rule.target_pattern ? new RegExp(rule.target_pattern) : null,
    arg_pattern_re: rule.arg_pattern_blocks ? new RegExp(rule.arg_pattern_blocks) : null,
    target_in_set: rule.target_in ? new Set(rule.target_in) : null,
    block_locales_set: rule.block_locales ? new Set(rule.block_locales) : null,
    allow_only_locales_set: rule.allow_only_locales ? new Set(rule.allow_only_locales) : null,
    applies_to_set: rule.applies_to ? new Set(rule.applies_to) : null,
  }));
  return { policy, rules };
}

// ─── Rate-limit counters ────────────────────────────────────────────────────

const WINDOW_MS: Record<RateWindow, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
};

/**
 * Per-process counter. In a fleet you swap this for a Redis-backed adapter
 * with the same interface — but the same signature keeps the hot path the
 * same shape and the latency budget intact.
 */
export class InMemoryRateCounter {
  private readonly buckets = new Map<string, number[]>();

  observe(key: string, atMs: number): void {
    let arr = this.buckets.get(key);
    if (!arr) {
      arr = [];
      this.buckets.set(key, arr);
    }
    arr.push(atMs);
  }

  countWithin(key: string, windowMs: number, atMs: number): number {
    const arr = this.buckets.get(key);
    if (!arr) return 0;
    const cutoff = atMs - windowMs;
    // O(n) over the bucket; in practice prune oldest entries to bound cost.
    let count = 0;
    for (let i = 0; i < arr.length; i++) {
      const ts = arr[i]!;
      if (ts >= cutoff) count++;
    }
    return count;
  }

  /** Drop entries older than the longest window we care about. */
  prune(beforeMs: number): void {
    for (const [k, arr] of this.buckets) {
      const next = arr.filter((t) => t >= beforeMs);
      if (next.length === 0) this.buckets.delete(k);
      else this.buckets.set(k, next);
    }
  }
}

// ─── Evaluate ───────────────────────────────────────────────────────────────

export interface EvaluateOptions {
  rate_counter?: InMemoryRateCounter;
  /** Caller-supplied wallclock for tests. Falls back to action.at or now(). */
  now?: () => Date;
}

export function evaluateAction(
  compiled: CompiledPolicy,
  action: PolicyAction,
  opts: EvaluateOptions = {},
): PolicyVerdict {
  const start = process.hrtime.bigint();
  const nowDate = opts.now ? opts.now() : (action.at ?? new Date());
  const nowMs = nowDate.getTime();
  const matched: string[] = [];
  let approvalRule: { id: string; reason: string } | null = null;

  // Fail CLOSED on a malformed amount. `NaN > cap` and `-1e9 > cap` are both
  // false, so without this guard a NaN/negative estimate sails past every
  // hard_cap_usd / approval_threshold_usd comparison below.
  const usd = action.estimated_usd;
  if (usd !== undefined && (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0)) {
    return blockVerdict("amount_validation", "invalid_amount", start);
  }

  for (const rule of compiled.rules) {
    if (!ruleApplies(rule, action)) continue;
    matched.push(rule.raw.id);

    if (rule.raw.outright_block) {
      return blockVerdict(rule.raw.id, "outright_block", start);
    }
    if (rule.arg_pattern_re && action.args_text && rule.arg_pattern_re.test(action.args_text)) {
      return blockVerdict(rule.raw.id, "arg_pattern", start);
    }
    if (rule.block_locales_set && action.locale && rule.block_locales_set.has(action.locale)) {
      return blockVerdict(rule.raw.id, "blocked_locale", start);
    }
    if (rule.allow_only_locales_set && (!action.locale || !rule.allow_only_locales_set.has(action.locale))) {
      return blockVerdict(rule.raw.id, "locale_not_allowlisted", start);
    }
    if (rule.raw.hard_cap_usd != null && (action.estimated_usd ?? 0) > rule.raw.hard_cap_usd) {
      return blockVerdict(rule.raw.id, "hard_cap_usd", start);
    }
    if (rule.raw.approval_threshold_usd != null && (action.estimated_usd ?? 0) > rule.raw.approval_threshold_usd) {
      approvalRule = { id: rule.raw.id, reason: "approval_threshold_usd" };
    }
    if (rule.raw.rate_limit && opts.rate_counter) {
      const key = `${rule.raw.id}:${action.kind}:${action.target}`;
      const count = opts.rate_counter.countWithin(
        key,
        WINDOW_MS[rule.raw.rate_limit.window],
        nowMs,
      );
      if (count >= rule.raw.rate_limit.max) {
        return blockVerdict(rule.raw.id, "rate_limit", start);
      }
      opts.rate_counter.observe(key, nowMs);
    }
  }

  if (approvalRule) {
    const latency_ns = Number(process.hrtime.bigint() - start);
    return {
      needs_approval: true,
      reason: approvalRule.reason,
      matched_rule: approvalRule.id,
      latency_ns,
    };
  }

  const latency_ns = Number(process.hrtime.bigint() - start);
  return { allowed: true, matched_rules: matched, latency_ns };
}

function ruleApplies(rule: CompiledRule, action: PolicyAction): boolean {
  if (rule.applies_to_set && !rule.applies_to_set.has(action.kind)) return false;
  if (rule.target_in_set && !rule.target_in_set.has(action.target)) return false;
  if (rule.target_pattern_re && !rule.target_pattern_re.test(action.target)) return false;
  return true;
}

function blockVerdict(rule_id: string, reason: string, start: bigint): PolicyVerdict {
  const latency_ns = Number(process.hrtime.bigint() - start);
  return { allowed: false, matched_rule: rule_id, reason, latency_ns };
}
