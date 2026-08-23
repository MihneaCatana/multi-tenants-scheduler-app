# syntax=docker/dockerfile:1.7
# Multi-stage build for the Simi backend.
ARG NODE_VERSION=20-bookworm-slim

# ---------------------------------------------------------------------------
# Base: Node + pnpm via corepack
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# deps: install production + dev dependencies (cached layer)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: compile TypeScript to ./dist with path aliases rewritten
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm typecheck && pnpm build

# ---------------------------------------------------------------------------
# prod-deps: install production dependencies only
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# dev: dev-ready image with non-root user + full node_modules
# Used by docker-compose.yml for hot-reload development.
# ---------------------------------------------------------------------------
FROM base AS dev
RUN groupadd --system --gid 1001 app && \
    useradd --system --uid 1001 --gid app --create-home --home-dir /app --shell /usr/sbin/nologin app
COPY --from=deps /app/node_modules ./node_modules
USER app

# ---------------------------------------------------------------------------
# runner: minimal runtime image
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

# Run as a non-root user for defense in depth.
RUN groupadd --system --gid 1001 app && \
    useradd --system --uid 1001 --gid app --create-home --home-dir /app --shell /usr/sbin/nologin app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Migration SQL lives under src/; ship it so the runtime migrate command works
# without the full source tree.
COPY --from=build /app/src/db/migrations ./src/db/migrations

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
