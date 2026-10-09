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
  && apt-get install -y --no-install-recommends git lsof fonts-liberation \
     libglib2.0-0 libnss3 libatk-bridge2.0-0 libdbus-1-3 libcups2 libxcb1 libxkbcommon0 \
     libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2 \
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
