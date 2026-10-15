# syntax=docker/dockerfile:1.7
#
# Production images for PokeDrop. One file, two final targets:
#
#   api  — the NestJS API; the same image runs the BullMQ worker and the
#          migration step with a different command (compose.production.yml)
#   web  — the Next.js standalone server
#
# docs/Deployment.md explains how they are built and run.

ARG NODE_IMAGE=node:22.20.0-bookworm-slim

# Prisma picks its migration engine by the OpenSSL it finds, at install time
# as well as at run time, so every stage that touches Prisma has it.
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

FROM runtime AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Everything, built once. API_INTERNAL_URL is read by `next build`: the /api
# rewrite is fixed into the web build, so it is the compose address of the API.
FROM base AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter @pokedrop/shared build \
 && pnpm --filter @pokedrop/api build \
 && pnpm --filter @pokedrop/web build

# The API's production dependencies only. Scripts are skipped (the root
# `prepare` wants husky, a dev dependency), so the Prisma client and the
# migration engine are produced explicitly.
FROM base AS api-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @pokedrop/api... \
 && pnpm rebuild --filter @pokedrop/api... @prisma/engines \
 && cd apps/api && pnpm exec prisma generate

FROM runtime AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=api-deps --chown=node:node /repo ./
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static apps/web/.next/static
# Created here so the named volume mounted on it starts out owned by `node`.
RUN mkdir -p apps/web/.next/cache/images && chown -R node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
