// Kept separate from api.ts and duck-typed on `code` so pages can use it
// without depending on the ApiError class (page tests mock '../api').
const CODE_MESSAGES: Record<string, string> = {
  AGENT_NOT_FOUND: 'This agent does not exist.',
  APPROVAL_NOT_FOUND: 'This approval does not exist.',
  EXECUTION_NOT_FOUND: 'This execution does not exist.',
  SCHEDULE_NOT_FOUND: 'This schedule does not exist.',
  ACTIVITY_NOT_FOUND: 'This activity record does not exist.',
  EXECUTION_QUEUE_DISABLED: 'The execution queue is not enabled on this server.',
  AGENT_NOT_ACTIVE: 'This agent is paused or disabled. Reactivate it before submitting new intents.',
  INVALID_EXECUTION_STATE: 'This execution can no longer be changed in its current state.',
  MAX_RETRIES_REACHED: 'This execution has used all of its retry attempts.',
  EXECUTION_CONFLICT: 'The execution changed while you were viewing it. It has been refreshed.',
};

/** Context-appropriate message for an error, falling back to the server message. */
export function describeApiError(error: unknown, fallback: string): string {
  const e = error as { code?: string; message?: string } | null;
  return (e?.code && CODE_MESSAGES[e.code]) || e?.message || fallback;
}
