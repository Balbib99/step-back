# syntax=docker/dockerfile:1
#
# One image with the whole product: the Node server (API, scheduled jobs) and the built web app
# it serves. Build it from the repository root, on the Raspberry Pi itself (arm64) or elsewhere
# with `--platform linux/arm64`:
#
#   docker build -f deploy/Dockerfile -t step-back .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------------------------------------------------------------------------------------------
# build: compile the web app and bundle the server into one file.
# Install scripts are skipped on purpose: nothing here runs SQLite, so the native module does
# not need to be compiled (that happens in the `deps` stage).
FROM base AS build
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w web && npm run bundle -w server

# ---------------------------------------------------------------------------------------------
# deps: the libraries the server needs at runtime, and nothing else. better-sqlite3 is native:
# it is downloaded prebuilt for this architecture or, failing that, compiled here, which is
# why the compilers live in this stage only.
FROM base AS deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server && npm cache clean --force

# ---------------------------------------------------------------------------------------------
# runtime: small, no compilers, not root.
FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/step-back.db \
    WEB_DIR=/app/web

COPY --from=deps /app/node_modules ./node_modules
# .mjs so Node treats the bundle as an ES module without needing a package.json next to it.
COPY --from=build /app/server/dist/index.js ./server.mjs
COPY --from=build /app/web/dist ./web

# The database, the crests and everything else that must survive an update live here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.mjs"]
