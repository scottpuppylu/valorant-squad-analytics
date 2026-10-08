# TASK-INFRA-DATABASE-PORTABILITY-01 — VPS Production images (multi-stage, npm + package-lock.json).
#   target `app`: standalone Node API (compiled JS, production dependencies only, non-root)
#   target `web`: Caddy edge serving the built frontend at / and proxying /api/* to `app`
# No secret is ever copied into an image; all configuration arrives at runtime through the environment.

FROM node:22-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Frontend at the site root (VPS), plus the server compile (tsc → plain ESM JavaScript).
RUN APP_BASE_PATH=/ npm run build && npx tsc -p tsconfig.server.json

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /srv/app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /build/dist-server ./dist-server
COPY --from=build /build/migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/node/main.js"]

FROM caddy:2 AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv/www
