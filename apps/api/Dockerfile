# 4evergent API — provider-neutral production image.
#
# Build from the REPOSITORY ROOT (the pnpm workspace root):
#   docker build -f apps/api/Dockerfile -t 4evergent-api .
#
# Run with secrets supplied at RUNTIME (never baked into the image):
#   docker run --rm -p 3000:3000 \
#     -e HOST=0.0.0.0 -e PORT=3000 \
#     -e API_KEYS='<key>:<ownerId>:<subject>' \
#     -e CORS_ORIGIN='https://<frontend-host>' \
#     -e DATABASE_PATH=/data/4evergent.db \
#     -e STELLAR_TESTNET_SECRET_KEY='S...' \
#     -v api-data:/data \
#     4evergent-api
#
# Deployment requirements are documented in docs/api.md.

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable

# Manifests only — cached until dependencies actually change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent-core/package.json ./packages/agent-core/
COPY packages/policy/package.json ./packages/policy/
COPY packages/database/package.json ./packages/database/
COPY packages/stellar/package.json ./packages/stellar/

RUN pnpm install --frozen-lockfile

# Sources, then build the workspace packages the API depends on.
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/cli ./apps/cli
COPY apps/web ./apps/web
COPY packages ./packages

RUN pnpm --filter @4evergent/api... build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/4evergent.db

# Dependencies only — no devDependencies, no test files.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/cli/package.json ./apps/cli/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent-core/package.json ./packages/agent-core/
COPY packages/policy/package.json ./packages/policy/
COPY packages/database/package.json ./packages/database/
COPY packages/stellar/package.json ./packages/stellar/

RUN corepack enable \
 && pnpm install --frozen-lockfile --prod

# Compiled output from the build stage.
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=build /repo/packages/policy/dist ./packages/policy/dist
COPY --from=build /repo/packages/database/dist ./packages/database/dist
COPY --from=build /repo/packages/stellar/dist ./packages/stellar/dist

# SQLite file location — mount a persistent volume here.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

# Runs the existing production entrypoint. Uses the repo's own start script
# (node apps/api/dist/server.js) — no inline env or secret material here.
CMD ["pnpm", "--filter", "@4evergent/api", "start"]