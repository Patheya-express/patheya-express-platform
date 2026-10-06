# syntax=docker/dockerfile:1

# Builds and runs apps/api-gateway out of the pnpm workspace at the repo root. Build context must
# be the repository root (not apps/api-gateway) so pnpm can resolve the workspace lockfile.
#
#   docker build -f Dockerfile -t patheya-express-api-gateway .
#
# See docs/deployment.md for required environment variables and the full run instructions.

ARG NODE_VERSION=24-alpine

# Populated via `docker build --build-arg` (all optional — the image builds and runs fine with
# their defaults). Purely descriptive OCI labels below; never baked into application behavior.
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
ARG IMAGE_VERSION=0.0.1

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

# Cache-mounted pnpm store persists across builds on the same builder (BuildKit only, already
# enabled via the `# syntax=` line above) — repeat builds skip re-downloading unchanged packages.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
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
# node-base: the Node.js runtime alone. The official image also ships npm, corepack and yarn,
# which neither the API nor the migration task ever invokes — they only add a package-manager
# toolchain (and its bundled tar/undici/brace-expansion/... CVEs) to the attack surface, so they
# are removed. `node` itself is untouched.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS node-base

RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

# ---------------------------------------------------------------------------
# migrate: the migration task target (`<tag>-migrate` in the same ECR repository) — run to
# completion by the ECS migration task definition with this image's own ENTRYPOINT/CMD, never as
# a long-running service. `prisma` (the CLI) is a production dependency of api-gateway, so
# `build`'s pruned `pnpm deploy --prod` output already contains it together with its engines;
# only that, the schema/migrations and package.json are copied — no workspace source, dev
# dependencies, compiler toolchain or pnpm.
# ---------------------------------------------------------------------------
FROM node-base AS migrate

RUN addgroup -S app && adduser -S app -G app

WORKDIR /workspace/apps/api-gateway

COPY --from=build --chown=app:app /workspace/deploy/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/apps/api-gateway/prisma ./prisma
COPY --from=build --chown=app:app /workspace/apps/api-gateway/package.json ./package.json

USER app

# Deployment audit finding (Production hardening — Render migration automation): the previous
# `pnpm --filter api-gateway exec prisma` entrypoint fails outside a TTY —
# `[ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY]`, pnpm's own dependency-status check trying to
# interactively confirm a node_modules purge and aborting instead — reproduced against a real
# build of this exact stage, unrelated to any other change; a real `kubectl run`/ArgoCD PreSync
# Job has no TTY either, so this was silently broken for that path too, not just discovered here.
# Invoking the already-resolved `prisma` binary directly sidesteps pnpm's CLI wrapper entirely —
# verified working end-to-end (a real `migrate deploy` against a real, deliberately-behind
# Postgres database) from this exact WORKDIR.
ENTRYPOINT ["node_modules/.bin/prisma"]

CMD ["migrate", "deploy"]

# ---------------------------------------------------------------------------
# runtime: minimal image — no package manager, no dev dependencies, no source.
# ---------------------------------------------------------------------------
FROM node-base AS runtime

ARG VCS_REF
ARG BUILD_DATE
ARG IMAGE_VERSION

LABEL org.opencontainers.image.title="patheya-express-api-gateway" \
      org.opencontainers.image.description="Patheya Express NestJS API Gateway" \
      org.opencontainers.image.source="https://github.com/patheya-express/patheya-express-platform" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.licenses="UNLICENSED"

# tini (PID 1) forwards signals (SIGTERM from `kubectl delete`/rolling updates) to the actual
# node process and reaps zombie children — running node directly as PID 1 handles neither
# correctly by default.
RUN apk add --no-cache tini

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=build --chown=app:app /workspace/deploy/node_modules ./node_modules
COPY --from=build --chown=app:app /workspace/apps/api-gateway/dist ./dist
COPY --from=build --chown=app:app /workspace/apps/api-gateway/prisma ./prisma
COPY --from=build --chown=app:app /workspace/apps/api-gateway/package.json ./package.json

# Winston's file transport writes to ./logs, and LocalStorageProvider writes to ./uploads (both
# relative to CWD) — WORKDIR created /app as root before the COPY layers above, so the non-root
# user below can't create either at boot time. Pre-created here so they exist with the right
# ownership regardless of whether a volume is later mounted over them (e.g. under Kubernetes with
# readOnlyRootFilesystem: true, an emptyDir is mounted at exactly these two paths).
RUN mkdir -p logs uploads && chown app:app logs uploads

USER app

EXPOSE 3000

# Checks the process-only liveness endpoint (LH1-10) — deliberately not the readiness endpoint,
# so a transient DB/Redis blip doesn't cause an orchestrator to kill an otherwise-healthy container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/api/v1/health/live'}, r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "dist/src/main.js"]
