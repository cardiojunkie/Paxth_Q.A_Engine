FROM node:24-bookworm-slim AS system

WORKDIR /app
RUN chown node:node /app
USER node

FROM system AS build

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

FROM node:24-bookworm-slim AS production

ENV NODE_ENV=production \
    HOME=/tmp \
    PORT=3000 \
    CLOAKBROWSER_CACHE_DIR=/var/cache/cloakbrowser \
    CLOAKBROWSER_AUTO_UPDATE=false

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npx --no-install playwright-core install-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && install -d -o node -g node /var/cache/cloakbrowser

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node certs ./certs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/server.js"]
