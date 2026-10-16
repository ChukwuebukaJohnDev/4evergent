# Contributing to 4evergent

Thank you for contributing. This document covers development setup, repository structure, testing, code style, PR expectations, and security reporting.

## Development setup

```bash
# clone
git clone https://github.com/naninu123/4evergent
cd 4evergent

# install (Node 22+, pnpm 10+)
pnpm install

# optional: local environment (loaded automatically by the API server)
cp .env.example .env

# build all packages
pnpm build
```

> **On a fresh checkout, run `pnpm build` before `pnpm typecheck`.**
> Workspace packages resolve each other through their build output: e.g.
> `packages/shared/package.json` points `types`/`main` at `./dist/index.*`, and
> `packages/agent-core` imports `@4evergent/shared`. Before the first build that
> `dist/` does not exist, so `pnpm typecheck` fails with
> `TS2307: Cannot find module '@4evergent/shared'`. The same ordering is used in
> CI (`Build` runs before `Typecheck`).

## Repository structure

```
4evergent/
├── apps/
│   ├── web/              # Frontend — React + TypeScript
│   └── api/              # Backend API — Express-style
├── packages/
│   ├── agent-core/       # IntentValidator, StellarAdapter
│   ├── policy/           # PolicyEngine (deterministic)
│   ├── stellar/          # Transaction pipeline (build → simulate → sign → submit)
│   ├── database/         # In-memory + SQLite stores (activity, approvals)
│   └── shared/           # Shared types & schemas
├── contracts/            # Rust workspace (own Cargo.lock, pinned toolchain)
│   ├── agent-registry/   # Soroban agent-registry contract (compiles, tested, builds wasm)
│   └── permissions/      # Soroban permissions contract (not in the workspace yet)
├── docs/
├── scripts/
└── README.md
```

## Testing

Run the full test suite:

```bash
pnpm test
```

Or run a single package:

```bash
pnpm --filter @4evergent/policy test
pnpm --filter @4evergent/agent-core test
```

Each package uses `tsx --test` as its test runner. Tests live in `test/` within each package.

### Test coverage

Every capability must include:
- Unit tests for intent validation
- Policy engine tests (positive + all negative cases)
- Integration test against the Horizon testnet API
- Negative tests (see below)

### Negative test cases to cover

- Amount exceeds per-tx limit
- Amount exceeds daily spending limit
- Unauthorized asset
- Unauthorized destination
- Unauthorized contract ID
- Malformed intent (missing fields)
- Missing human approval for threshold amount
- Invalid agent owner

## Working on contracts/

Run cargo from inside `contracts/` (`cd contracts && cargo test`) so `contracts/rust-toolchain.toml` (pinned 1.81.0) applies. The wasm target is `wasm32-unknown-unknown`. `contracts/Cargo.lock` is committed on purpose — builds are reproducible via `--locked`; use `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo generate-lockfile` when dependencies change so the MSRV-aware resolver keeps versions 1.81-compatible.

## Code style

- TypeScript with strict mode enabled.
- All relative imports use explicit `.ts` extensions (Node ESM).
- Use `Exact Optional Property Types` — no implicit `undefined`.
- Prefer pure functions for policy/engine logic.
- Run `pnpm lint` (ESLint flat config at the repo root). `@typescript-eslint/no-unused-vars`
  is an error and ignores names prefixed with `_`; `@typescript-eslint/no-explicit-any` is
  off on purpose. Keep lint fixes mechanical and in-scope for the PR.

## PR expectations

- All tests must pass (`pnpm test`).
- Lint must pass (`pnpm lint`).
- Typecheck must pass (`pnpm typecheck`) — run `pnpm build` first on a fresh checkout.
- Include tests for any new intent type, policy rule, or capability.
- Add entries to `docs/architecture.md` if you make an architecture decision.
- Link the PR to a GitHub issue where applicable.
- PRs should be scoped — one capability per PR is ideal.

## Issue categories

Use these labels when filing issues:

| Label | Use for |
|-------|---------|
| `bug` | Something that isn't working |
| `enhancement` | New capability or improvement |
| `security` | Vulnerability or hardening need |
| `documentation` | Docs gap or inaccuracy |
| `testing` | Missing or flaky tests |
| `policy` | Policy engine rule or behavior |
| `stellar` | Stellar adapter / Horizon integration |
| `contracts` | Soroban contract work |
| `frontend` | Web dashboard UI |

## Security reporting

If you find a security vulnerability:

1. Do NOT open a public issue.
2. Report it through GitHub's private vulnerability reporting on the
   [naninu123/4evergent repository](https://github.com/naninu123/4evergent/security/advisories/new)
   (Security tab → "Report a vulnerability"). If that mechanism is
   unavailable, open a GitHub security advisory draft or contact the maintainer,
   @naninu123, directly on GitHub.
3. Include: description, reproduction steps, potential impact.
4. You will receive a response within 48 hours.

See [SECURITY.md](SECURITY.md) for the full policy.
