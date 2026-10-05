FROM node:22-bookworm-slim AS system
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app && chown node:node /app
USER node
WORKDIR /app

FROM system AS development
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git lsof \
  && rm -rf /var/lib/apt/lists/*
USER node

FROM system AS build
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . ./
RUN npm run build

FROM system AS production
ENV NODE_ENV=production
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
