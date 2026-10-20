/**
 * Single source of truth for machine-readable API error codes.
 * The code is the stable contract; the message is human-readable and may change.
 */
export const API_ERRORS = {
  UNAUTHORIZED: { status: 401, message: "unauthorized", description: "Missing or invalid credentials." },
  CSRF_FAILED: { status: 403, message: "csrf_failed", description: "Session request failed the CSRF header check." },
  NOT_FOUND: { status: 404, message: "Not found", description: "Unknown route." },
  AGENT_NOT_FOUND: { status: 404, message: "Agent not found", description: "The agent does not exist or is not owned by the caller." },
  APPROVAL_NOT_FOUND: { status: 404, message: "Approval not found", description: "The approval does not exist or is not owned by the caller." },
  EXECUTION_NOT_FOUND: { status: 404, message: "Execution not found", description: "The execution does not exist or is not owned by the caller." },
  SCHEDULE_NOT_FOUND: { status: 404, message: "Schedule not found", description: "The schedule does not exist or is not owned by the caller." },
  ACTIVITY_NOT_FOUND: { status: 404, message: "Activity not found", description: "The activity record does not exist or is not owned by the caller." },
  EXECUTION_QUEUE_DISABLED: { status: 404, message: "Execution queue not enabled", description: "The execution queue is not enabled on this server." },
  INVALID_PATH_PARAM: { status: 400, message: "Invalid path parameter", description: "A path identifier is missing or malformed." },
  INVALID_JSON: { status: 400, message: "Invalid JSON body", description: "The request body is not valid JSON." },
  VALIDATION_ERROR: { status: 400, message: "Validation failed", description: "A field failed validation; see message and optional details." },
  RAW_TRANSACTION_REJECTED: { status: 400, message: "Raw XDR and transaction blobs are not accepted; submit a typed intent", description: "Raw transaction payloads are not accepted." },
  IDEMPOTENCY_KEY_INVALID: { status: 400, message: "Idempotency-Key must be 256 characters or fewer", description: "The Idempotency-Key header is too long." },
  IDEMPOTENCY_CONFLICT: { status: 409, message: "Idempotency-Key already used with a different intent", description: "The Idempotency-Key was already used with a different intent." },
  AGENT_NOT_ACTIVE: { status: 409, message: "Agent is not active; new intents are rejected", description: "The agent is paused or disabled." },
  INVALID_EXECUTION_STATE: { status: 409, message: "Execution is in a state that does not allow this action", description: "The execution status does not allow the requested action." },
  MAX_RETRIES_REACHED: { status: 409, message: "Max retry attempts reached", description: "The execution has used all retry attempts." },
  APPROVAL_INVALID_STATE: { status: 409, message: "Approval is in a state that does not allow this action", description: "The approval status does not allow the requested approve or reject." },
  SCHEDULE_INVALID_TRANSITION: { status: 409, message: "Schedule status does not allow this transition", description: "The schedule status does not allow the requested pause, resume or disable." },
  EXECUTION_CONFLICT: { status: 409, message: "Execution state changed; please refresh", description: "The execution changed concurrently." },
  APPROVAL_EXPIRED: { status: 410, message: "Approval expired", description: "The approval passed its expiry before it was approved." },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;
