# Changelog

All notable changes to this project are recorded in this file.

## [Unreleased]

### Security
- Atomic execution claim via `updateIfStatus(queued→executing)` CAS to prevent concurrent workers from executing the same record (Phase 18A)
- Idempotency-Key header support for `POST /agents/:id/intents` to prevent duplicate financial execution from repeated API requests (Phase 18B)
- Horizon pre-check mitigation before blind retry — guards against duplicate submission when original transaction may have reached Horizon (Phase 18C)

### Added
- `ExecutionRecord.submittedHash` field persisted on all pipeline paths for pre-check identification
- `ExecutionQueue.preCheck` option for pluggable transaction status verification
- `PreCheckFn` / `PreCheckResult` types for adapter-level integration
- `StellarAdapter.getTransactionStatus()` used as preCheck implementation in API server

### Changed
- `StellarSubmitter.submit()` error now preserves `preSubmitHash` for recovery/reconciliation
- `TransactionPipeline` carries `idempotencyKey` through all execution paths
- `ActivityStore.recordIdempotent()` for atomic key-based reservation

### Documentation
- Phase 19A: refreshed README, CONTRIBUTING, security-model, architecture, testnet docs
- Added SECURITY.md, issue templates, PR template

## [0.1.0] — Project inception through Phase 18

- Monorepo scaffold with pnpm workspaces
- Policy engine (deterministic, pure function)
- Intent validation (payment, trustline, contract_call, account_settings)
- Transaction pipeline: build → simulate → sign → submit
- Activity/approval logging with in-memory + SQLite stores (`node:sqlite`)
- Execution queue with retry, dead-letter, and crash recovery
- Agent self-serve creation via `POST /agents`
- Agent scheduling & automation
- Web dashboard (React + TypeScript + Vite)
- GitHub Actions CI (build/typecheck/test)

[Unreleased]: https://github.com/naninu123/4evergent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/naninu123/4evergent/releases/tag/v0.1.0
