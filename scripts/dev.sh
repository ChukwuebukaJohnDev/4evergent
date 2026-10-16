#!/usr/bin/env bash
# 4evergent local development script.
# Builds all packages and runs the test suite.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
pnpm install

echo "==> Building packages"
pnpm build

echo "==> Running tests"
pnpm test

echo "==> Type checking"
pnpm typecheck

echo "Done."
