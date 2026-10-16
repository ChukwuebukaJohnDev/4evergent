# 4evergent Development Roadmap

| Phase | Goal | Status |
|-------|------|--------|
| 1 | Agent identity types, policy engine, intent validation, Stellar read adapter | Shipped |
| 2 | Full transaction pipeline (construct → simulate → authorize → sign → submit) with Signer abstraction | **Shipped** |
| 3 | Persistent SQLite stores, approval/reject HTTP endpoints, daily limit enforcement from activity state | **Shipped** |
| 4 | React web dashboard (Overview / Agents / Activity / Approvals / Submit Intent) + read-only API endpoints | **Shipped** |
| 5 | Soroban AgentRegistry contract (register/update/deactivate/query) | **Deployed on Testnet** |
| 6 | Soroban Permissions contract (delegation + revocation) | Intentionally **not** deployed (not compiled; needs its own DESIGN pass) |
| 7 | Multi-agent capability discovery & agent-to-agent economy | Future |
| 8 | Agent scheduling & automation | **Shipped** |
| 9 | Persistent execution queue with retry & dead-letter | **Shipped** |
| 10 | Execution queue crash recovery | **Shipped** |
| 11 | Agent self-serve creation & onboarding | **Shipped** |

## Phase 11 Details (Shipped)

### What was implemented

- **AgentStore** (`packages/database/src/agent-types.ts`, `agent-store.ts`): `AgentStore` interface + InMemory + SQLite via `node:sqlite`, schema version 1. Exposes `create`, `get`, `getForOwner`, `listByOwner`, `update`, `delete` with owner-scoped queries.
- **POST /agents endpoint** (`apps/api/src/index.ts`): validates `displayName` (required, ≤100 chars), `description`, `capabilities` (array of strings), `stellarAddress` (string). Binds to `requestCtx.ownerId`, persists via `AgentStore`, returns 201 with `agent` record.
- **Frontend Agents page** (`apps/web/src/pages/Agents.tsx`): empty state with "Create Agent" button, modal form with loading/validation/API error/success handling. Updated `api.ts` with `createAgent()` method. Added modal/form CSS to `styles.css`.
- **Shared types** (`packages/shared/src/types.ts`): `CreateAgentInput`, `CreateAgentRequest` matching API request shape.
- **Backward compatibility**: existing `registerAgent()` now syncs to both in-memory Map and persistent store. All test helpers using `registerAgent()` continue to work.
- **ADR-013** in `docs/architecture.md`
- 18 new tests (10 API agent-create, 8 DB agent-store)

## Phase 8 Details (Shipped)

### What was implemented

- **AgentScheduler** (`apps/api/src/scheduler.ts`): polls `ScheduleStore.listDue()` on configurable interval (default 60s), executes due schedules via typed callback, updates lastRunAt/nextRunAt, failure isolation per schedule, start/stop lifecycle
- **ScheduleExecutionService** (`apps/api/src/schedule-execution.ts`): runs a scheduled intent through the SAME `TransactionPipeline.execute()` as manual intents; rebuilds `sourceAccount` from signer via `StellarAdapter`
- **API server wiring** (`apps/api/src/index.ts`): scheduler opt-in via `options.scheduler.enabled`, integrated into server lifecycle (start/stop), typed callback returns `ScheduleExecutionResult`
- **ScheduleExecutionResult** (`apps/api/src/schedule-execution.ts`): result type merging PipelineOutcome with scheduler-specific fields
- 10 scheduler tests + 4 integration tests

## Phase 9 Details (Shipped)

### What was implemented

- **ExecutionStore** (`packages/database/src/execution-types.ts`, `execution-store.ts`): `ExecutionRecord` with full lifecycle status (`queued → executing → submitted → confirmed → failed → dead_letter`), InMemory + SQLite via `node:sqlite`, schema version 1. Exposes `listDue`, `listByOwner`, `listByAgent`, `getForOwner`,atomic `update`
- **ExecutionQueue** (`apps/api/src/execution-queue.ts`): polls due records, transitions to `executing`, invokes pipeline executor, moves to terminal state or schedules retry with backoff. Bounded concurrency, duplicate safety via status-claim guard
- **Error classification** (`packages/database/src/execution-policy.ts`): transient (network/Horizon/submission) vs permanent (policy deny, validation, auth). Bounded retry (max 3, configurable) with exponential backoff capped at maxDelayMs. Permanent failures short-circuit to dead_letter
- **API server integration** (`apps/api/src/index.ts`): approve enqueues `ExecutionRecord` (preserving `approvalId`) instead of fire-and-forget; scheduler enqueues with `activityId`; owner-scoped read endpoints `GET /agents/:id/executions`, `GET /executions/:id`, `GET /agent-queue`; `createApiServer` returns `executionStore`, `executionQueue`
- **ADR-012** in `docs/architecture.md`
- 20 new tests (enqueue+process, retry→dead_letter, transient→retry, permanent→no retry, crash recovery, duplicate safety, error classification, backoff formula, owner isolation, approval boundary, scheduler+manual regression)

## Phase 10 Details (Shipped)

### What was implemented

- **Crash recovery query** (`packages/database/src/execution-types.ts`, `execution-store.ts`): `ExecutionStore.listStuckExecuting()` returns records with `status === "executing"` ordered by `created_at ASC`; implemented in both InMemory and SQLite stores
- **ExecutionRecoveryService** (`apps/api/src/execution-recovery.ts`): startup recovery service with `recover()` method — scans stuck executions, re-fetches each for idempotency guard, transitions to `failed` with immediate `nextRetryAt`, preserves `attempt`/`errorClass`, does NOT create duplicates, does NOT execute transactions
- **Startup lifecycle** (`apps/api/src/index.ts`): `createApiServer()` is now `async`; recovery runs BEFORE queue worker starts eliminating race condition (store init → recovery scan → worker start); all test files updated to `await createApiServer()`; `recoveryService` exposed via return value
- **ADR-012** updated in `docs/architecture.md` with crash recovery details
- 10 new tests (executing→failed, retry count preserved, terminal states untouched, no duplicates, idempotent second call, queue reprocesses recovered record, owner isolation, queue disabled no worker, nextRetryAt immediately eligible, startedAt cleared)

## Phase 2 Details (Shipped)

### What was implemented

- **Signer interface** (`packages/stellar/src/signer.ts`): abstraction with `getAccountId()`, `getNetworkPassphrase()`, `sign()`. No key-exposing methods.
- **TestnetLocalSigner** (`packages/stellar/src/testnet-local-signer.ts`): testnet-only development signer. Loads from env, never exposes secrets, never committed.
- **StellarTransactionBuilder** (`packages/stellar/src/transaction-builder.ts`): constructs unsigned Stellar transactions from validated `PaymentIntent` only. Does NOT accept raw XDR or arbitrary operation arrays. MVP supports XLM payments only.
- **StellarSimulator** (`packages/stellar/src/simulator.ts`): mandatory simulation gate. Calls real Horizon API (`fetchBaseFee`, `accounts().accountId()`). No fake results. A failed simulation prevents signing.
- **StellarSubmitter** (`packages/stellar/src/submitter.ts`): submits signed transactions. Rejects unsigned transactions (no signatures).
- **TransactionPipeline** (`packages/stellar/src/pipeline.ts`): orchestrates the ordered gate chain — validate → policy → authorize → construct → simulate → sign → submit → record. The only public entry point.
- **Activity storage** (`packages/database/src/index.ts`): in-memory activity log with `assertNoSecrets()` guard. Records intent, policy decision, authorization status, simulation result, tx hash, status, timestamps.
- **API server** (`apps/api/src/index.ts`): `POST /agents/:id/intents` endpoint implementing the full pipeline. Returns 400 for malformed/raw input, 403 for policy DENY, 202 for requires_approval, 200 for submitted. `GET /health` endpoint.
- **Security tests** (15 tests): verify DENY prevents construction, failed simulation prevents signing, amount above limit never reaches signer, unauthorized asset/destination never reach signer, approval-required never reaches signer before approval, signer interface has no key-exposing methods.
- **Integration tests** (10 tests): verify API rejects raw XDR, returns 403 for denied intents, 202 for approval-required, 400 for unsupported intent types, records activity for all outcomes, never leaks secrets in responses.

### Phase 3 Details (Shipped)

### What was implemented

- **SQLite-backed persistent stores** (`packages/database/src/sqlite-store.ts`): `SQLiteActivityStore` and `SQLiteApprovalStore` backed by Node.js built-in `node:sqlite` (Node 22+; verified on Node 26.7). Schema versioned in `_meta` table (version 1); `initSchema()` is idempotent. Activity and approval records persist across process restarts (tested via reopen simulation). The unique partial index `idx_approvals_activity_one` enforces at most one `PENDING_APPROVAL` per activity id.
- **Approval HTTP endpoints** (`apps/api/src/index.ts`): `POST /approvals/:id/approve` and `POST /approvals/:id/reject` implement stateful transitions with `validateApprovalTransition()` guard. Approve marks record `approved` then fires `pipeline.executeApproved()` async via `setImmediate` (skippable via `deferExecution: true`). Reject rejects only from `pending_approval` state.
- **Daily spending limit enforcement** (`packages/policy/src/engine.ts`): `PolicyEngine.evaluate()` is now `async` and accepts an `ActivityStore`. `getDailySpent()` reads the current UTC day's `submitted` activities for the agent and deducts from the daily limit. Read-then-write; no transactional lock.
- **Pipeline integration** (`packages/stellar/src/pipeline.ts`): `TransactionPipeline` accepts optional `activityStore`/`approvalStore` in constructor. `execute()` records every outcome (denied/submitted/failed/simulation_failed). New `executeApproved(approvalId, approver)` method reconstructs the intent from the stored approval, re-runs construction+simulation+signing+submission, and updates the approval status to `submitted`/`failed`/`expired`/`executing`.
- **API server auto-selects store** (`apps/api/src/index.ts`): if `dbPath` provided → SQLite stores; else → in-memory. `assertNoSecrets()` invoked on every record returned through the API.
- **Security tests** (15 tests): all pass. Tests prove daily limit deny when cumulative exceeded, daily limit allow when under cap, executeApproved rejects nonexistent/pending/expired, double-approval is blocked, raw XDR injection is rejected at approve/reject endpoints.
- **API approval integration tests** (10 tests): all pass. Approve/reject lifecycle, 404 for unknown approval, 409 for double-approve and approve-then-reject, XDR injection rejected, no secret leakage in responses.

### Known Limitations

- **Signer**: `TestnetLocalSigner` is testnet-only. `UserWalletSigner`, `AgentPermissionSigner`, `HardwareSigner`, `KmsSigner` are NOT implemented — the interface is ready but the implementations are deferred.
- **Approval persistence**: Phase 3 ships with `SQLiteApprovalStore`, but the in-memory fallback (`InMemoryApprovalStore`) still loses records on restart if `dbPath` is not configured.
- **Cross-agent approval isolation**: NOT enforced. Any party holding an `approvalId` can approve/reject it. Documented in security-test "approve approval belonging to other agent — current impl allows".
- **Async fire-and-forget**: After approve, execution runs via `setImmediate` with no retry or dead-letter queue. If the process exits or execution throws, the approval stays in `approved`/`executing` state indefinitely.
- **Activity persistence**: `InMemoryActivityStore` is process-local. Records are lost on process restart unless `dbPath` is configured.
- **Agent registry**: In-memory agent map in the API server. No persistent agent storage.
- **Daily spending limit race**: Read-then-write against the activity store. Two concurrent intents for the same agent can both pass the daily check before either record lands. No `BEGIN IMMEDIATE` or advisory lock around the check-then-record.
- **Simulation**: For classic (non-Soroban) transactions, Horizon has no dry-run API. Simulation checks sequence, fee, balance, and envelope validity — but signature correctness is only checked at submission time. For Soroban contract calls, the Soroban-RPC `simulateTransaction` endpoint should be used (not yet implemented).
- **Transaction types**: Only XLM payments are supported. Trustline, contract_call, and account_settings intents pass validation but return 400 from the API ("not yet supported by the transaction pipeline").
- **Mainnet**: Not tested. The pipeline asserts the network passphrase of the signer matches the signer passphrase, and `TestnetLocalSigner` is wired to the testnet passphrase in the pipeline constructor.
- **Soroban contracts**: `agent-registry` is compiled, tested (15 unit tests) and deployed to Stellar Testnet — see `docs/testnet.md`. `permissions` is intentionally **not** deployed: it is excluded from the contracts workspace, is not compiled or tested, lacks authorization checks, and needs its own DESIGN pass before any work resumes (`contracts/permissions/README.md`).
- **No KMS/HSM or user-custodied signer**: Production wallet implementations are deferred.
- **Live testnet submission**: No live Stellar testnet calls were executed. All tests use deterministic mocks and in-process HTTP servers.

### Live Testnet Calls

No live Stellar testnet calls were executed during Phase 2 and Phase 3 implementation. All tests use deterministic mocks and in-process HTTP servers. The simulation and submission code paths call real Horizon APIs, but they are only reachable through the pipeline after policy ALLOW (which the test suite gates via DENY or requires_approval). A live testnet smoke test (`packages/stellar/test/live-smoke.ts`) is present but excluded from the default suite; run it manually with `npx tsx test/live-smoke.ts` when a funded testnet account is available.

## Phase 4 Details (Shipped)

### What was implemented

- **Web dashboard** (`apps/web`): React + TypeScript + Vite single-page app.
  - Overview page: signer account ID, agent count, network/pipeline status.
  - Agents page: list registered agents (id, name, address, capabilities, active status).
  - Activity page: aggregated activity records across agents (id, agent, intent type, amount, status, timestamp).
  - Approvals page: pending approval list with Approve and Reject buttons (reject requires confirmation dialog).
  - Submit Intent page: XLM payment intent form with client-side validation (amount positive, destination G..., reason ≥ 3 chars).
  - Navigation via sidebar tabs.
  - Loading, empty, and error states on all data-driven pages.
- **API read endpoints** (`apps/api/src/index.ts`):
  - `GET /agents` — public agent list (no secret fields).
  - `GET /agents/:id/activity?limit=N` — persisted activity per agent (limit clamped 1–100).
  - `GET /approvals?status=<status>` — approval list, optional status filter.
- **Store interface** (`packages/database/src/index.ts`): added `listAll(limit?)` to `ActivityStore` and `ApprovalStore`, implemented in all 4 store variants (in-memory + SQLite).
- **Frontend tests** (`apps/web/src/pages/__tests__/Approvals.test.tsx`): 6 vitest + RTL tests covering loading, empty state, approval row rendering, approve action, reject confirmation, reject cancel.
- **API tests** (`apps/api/test/read-endpoints.test.ts`): 9 tests covering agents list, empty list, activity retrieval, limit param, approvals list, status filtering, secret/XDR leak checks.

### Known Limitations (Phase 4 additions)

- **Frontend trust boundary**: The dashboard never receives private keys, seeds, secrets, or raw XDR. All policy evaluation, signing, and submission remain server-side.
- **Approval ownership**: Approve/reject endpoints are authenticated and owner-scoped (request-scoped authentication via `Authorization` header; `canApprove`/`canReject` verify the caller owns the agent). Historical note: before Phase 28K these endpoints were unauthenticated.
- **Intent submission**: The Submit page supports XLM payment and trustline intents (Phase 12). No UI for contract_call, account_settings, or raw XDR.
- **Frontend does NOT bypass the approval state machine** — Approve/Reject buttons call the same backend endpoints that enforce transitions.
