/**
 * Result interface — mirrors the subset of TransactionPipeline's return value
 * that we need for error classification. Defined locally to avoid importing
 * @4evergent/stellar (which would create a circular dependency).
 */
export interface PipelineOutcomeLike {
  status: string;
  message?: string;
}

/**
 * Error classification for execution retry decisions.
 *
 *   transient  → may succeed on retry (e.g., network, simulation, submission)
 *   permanent  → will never succeed (e.g., invalid intent, policy deny, auth)
 */
export type ErrorClass = "transient" | "permanent";

/**
 * Classify a pipeline outcome for retry eligibility.
 *
 * Policy: only simulation_failed, submission_failed, and unknown errors are
 * transient. Validation failures, policy denials, authorization failures, and
 * construction errors are permanent.
 */
export function classifyPipelineOutcome(outcome: PipelineOutcomeLike): ErrorClass {
  switch (outcome.status) {
    case "simulation_failed":
    case "rejected":
      // "rejected" covers construction/signing/submission failures.
      // These may be transient (network) or permanent (bad intent).
      // Default to transient if the message suggests a network/remote error.
      return outcome.message && isTransientError(outcome.message) ? "transient" : "permanent";
    default:
      return "permanent";
  }
}

/**
 * Classify an arbitrary error (e.g., from an uncaught exception).
 */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof Error) {
    return isTransientError(error.message) ? "transient" : "permanent";
  }
  return "transient"; // unknown errors are retried conservatively (bounded)
}

const TRANSIENT_PATTERNS: (string | RegExp)[] = [
  /network/i,
  /fetch/i,
  /timeout/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /socket/i,
  /horizon/i,
  /server error/i,
  /503/,
  /429/,
  /account fetch error/i,
  /transaction submission failed/i,
];

function isTransientError(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => {
    if (typeof p === "string") return lower.includes(p);
    return p.test(lower);
  });
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
};

/**
 * Determine whether an execution should be retried based on its current
 * attempt count, error class, and retry policy.
 *
 * Returns false if the execution should be moved to dead_letter.
 */
export function shouldRetry(
  attempt: number,
  errorClass: ErrorClass,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): boolean {
  if (errorClass === "permanent") return false;
  return attempt < policy.maxRetries;
}

/**
 * Compute the next retry timestamp using exponential backoff.
 *
 *   delay = min(baseDelayMs * 2^(attempt-1), maxDelayMs)
 *
 * attempt is 0-based (first attempt = 0). After attempt N fails, the retry
 * backoff uses attempt+1.
 */
export function computeNextRetryAt(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  now: Date = new Date()
): string {
  // Backoff: baseDelay * 2^attempt (0-based — first retry = baseDelay)
  const delay = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
  return new Date(now.getTime() + delay).toISOString();
}
