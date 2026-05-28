/**
 * Normalized capture-failure error for payment rails.
 *
 * Before this, a failing `capturePayment()` surfaced the raw provider error
 * (Stripe `APIError`, a fetch `TypeError`, an LND HTTP body, ...), which is
 * hard to act on at the call site. `RailCaptureError` wraps those in a
 * consistent shape while preserving the underlying cause via `.originalError`,
 * and attaches a `hint` for the most common failure modes.
 */

export interface RailCaptureErrorContext {
  /** Rail-side payment/hold id being captured. */
  externalId?: string;
  amount?: number;
  agentId?: string;
  currency?: string;
  /** Override the auto-derived hint. */
  hint?: string;
}

export class RailCaptureError extends Error {
  readonly railName: string;
  readonly originalError: unknown;
  readonly externalId?: string;
  readonly amount?: number;
  readonly agentId?: string;
  readonly currency?: string;
  readonly hint?: string;

  constructor(
    railName: string,
    originalError: unknown,
    ctx: RailCaptureErrorContext = {},
  ) {
    const cause = messageOf(originalError);
    const hint = ctx.hint ?? RailCaptureError.hintFor(originalError);
    super(`[${railName}] capture failed: ${cause}${hint ? ` (hint: ${hint})` : ""}`);

    this.name = "RailCaptureError";
    this.railName = railName;
    this.originalError = originalError;
    this.externalId = ctx.externalId;
    this.amount = ctx.amount;
    this.agentId = ctx.agentId;
    this.currency = ctx.currency;
    this.hint = hint;

    // Preserve the cause chain for runtimes/tools that read Error.cause.
    if (originalError !== undefined) {
      (this as { cause?: unknown }).cause = originalError;
    }
    // Restore prototype chain when targeting older ES output.
    Object.setPrototypeOf(this, RailCaptureError.prototype);
  }

  /** Map the top common capture failures to an actionable hint. */
  static hintFor(error: unknown): string | undefined {
    const haystack = `${codeOf(error)} ${messageOf(error)}`.toLowerCase();

    if (/insufficient|insufficient_funds|\bbalance\b|low.*funds/.test(haystack))
      return "insufficient funds — payer card/wallet lacks balance";
    if (/idempot/.test(haystack))
      return "idempotency-key reuse — this capture id was already submitted with different params";
    if (/expire|expired|validbefore|auth.*(elapsed|window)/.test(haystack))
      return "authorization expired — the hold/auth window elapsed; re-create the hold";
    if (/rate.?limit|too.?many.?requests|\b429\b/.test(haystack))
      return "rate limited — back off and retry";
    if (/unauthor|forbidden|\b401\b|\b403\b|api.?key|invalid.*secret|permission/.test(haystack))
      return "auth/credentials rejected — check the rail API key and permissions";
    if (/not.?found|no.?such|unknown.*(id|reference)|missing.*hold/.test(haystack))
      return "hold/reference not found — check externalId and that it was created on this rail instance";
    if (/timeout|etimedout|econnreset|econnrefused|enotfound|network|fetch.?failed|socket|dns/.test(haystack))
      return "network/provider unreachable — retry with backoff";

    return undefined;
  }
}

/**
 * Run a rail's capture execution, normalizing any thrown error into a
 * `RailCaptureError`. Idempotent: an error that is already a
 * `RailCaptureError` is rethrown unchanged.
 */
export async function runRailCapture<T>(
  railName: string,
  ctx: RailCaptureErrorContext,
  exec: () => Promise<T>,
): Promise<T> {
  try {
    return await exec();
  } catch (err) {
    if (err instanceof RailCaptureError) throw err;
    throw new RailCaptureError(railName, err, ctx);
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error === undefined) return "unknown error";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    return String(e.code ?? e.type ?? e.statusCode ?? e.status ?? "");
  }
  return "";
}
