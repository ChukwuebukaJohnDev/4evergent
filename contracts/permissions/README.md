# permissions (experimental)

⚠️ **Do not deploy. Not audited. Not accepting contributions yet.**

This directory holds an unfinished Soroban contract scaffold for permission
delegation. It is kept in the repository as a design placeholder, not as
shippable code.

## Status

- **Experimental and unfinished.** The implementation is a first sketch and does
  not match the intended design.
- **Excluded from the contracts workspace on purpose.** `contracts/Cargo.toml`
  lists only `agent-registry` as a member, and this crate is absent from
  `contracts/Cargo.lock`.
- **Not built in CI.** The contracts CI job builds and tests the workspace, so
  nothing here is compiled or tested on any pipeline.

## Not audited — do not deploy

This contract has not been reviewed or audited. Its state-changing functions are
known to **lack authorization checks**, so it does not enforce who may call them.
Deploying it would put the state it manages at risk.

Treat everything here as unsafe until a design pass and a review have happened.

## Needs its own design pass

The crate requires a dedicated design effort before any implementation work
resumes — covering the authorization model, the storage layout, and the intended
lifecycle of a permission. That design has not been written yet.

It is **not open for external contributions** at this time. If you are looking
for a starting point, the `agent-registry` contract next door is active,
compiled, tested, and documented in `contracts/agent-registry/DESIGN.md`.

## Building

There is nothing to build here yet. Running cargo from this directory would not
pick up the workspace toolchain or lockfile; `cd contracts && cargo test` covers
only the workspace members.
