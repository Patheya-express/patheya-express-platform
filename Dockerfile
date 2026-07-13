# syntax=docker/dockerfile:1

# Builds and runs apps/api-gateway out of the pnpm workspace at the repo root. Build context must
# be the repository root (not apps/api-gateway) so pnpm can resolve the workspace lockfile.
#
#   docker build -f Dockerfile -t patheya-express-api-gateway .
#
# See docs/deployment.md for required environment variables and the full run instructions.

ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------------------
# build: installs the full workspace, generates the Prisma client, compiles
# TypeScript, then produces a production-only dependency set for api-gateway.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build

# bcrypt is a native module and needs a toolchain to build from source on alpine.
RUN apk add --no-cache python3 make g++

RUN corepack enable

WORKDIR /workspace

# `prisma generate` reads `env("DATABASE_URL")` from the schema's datasource block at codegen
# time — it never connects to a database, but some Prisma versions require the var to at least
# be set. The real value is always supplied at container runtime, never baked into the image.
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter api-gateway exec prisma generate
RUN pnpm --filter api-gateway run build
# --legacy: api-gateway has no workspace-package dependencies (confirmed — apps/api-gateway
# doesn't depend on packages/*), so there's nothing to injection-link; pnpm v10+'s default
# deploy mode requires "inject-workspace-packages=true" even when there's nothing to inject.
RUN pnpm --filter api-gateway deploy --prod --legacy /workspace/deploy

# `pnpm deploy` re-resolves @prisma/client fresh from the store rather than reusing the already-
# generated copy from the `prisma generate` step above, so deploy's copy still has the raw,
# un-generated package content (no query engine / enums — confirmed by a runtime crash without
# this, `UserRole` reading as undefined). `prisma generate` always resolves its output via the
# schema file's own location, ignoring cwd, so it can't be re-pointed at deploy directly —
# instead, copy the already-generated `.prisma` directory over deploy's stale stub copy.
RUN SRC=$(find /workspace/node_modules/.pnpm -maxdepth 3 -type d -name '.prisma' | head -1) && \
    DEST=$(find /workspace/deploy/node_modules/.pnpm -maxdepth 3 -type d -name '.prisma' | head -1) && \
    rm -rf "$DEST" && cp -r "$SRC" "$DEST"

# ---------------------------------------------------------------------------
# runtime: minimal image — no package manager, no dev dependencies, no source.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=build --chown=app:app /workspace/deploy/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/apps/api-gateway/dist ./dist
COPY --from=build --chown=app:app /workspace/apps/api-gateway/prisma ./prisma
COPY --from=build --chown=app:app /workspace/apps/api-gateway/package.json ./package.json

# Winston's file transport writes to ./logs (relative to CWD) — WORKDIR created this directory
# as root before the COPY layers above, so the non-root user below can't create it at boot time.
RUN mkdir -p logs && chown app:app logs

USER app

EXPOSE 3000

# Checks the process-only liveness endpoint (LH1-10) — deliberately not the readiness endpoint,
# so a transient DB/Redis blip doesn't cause an orchestrator to kill an otherwise-healthy container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/api/v1/health/live'}, r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/src/main.js"]
