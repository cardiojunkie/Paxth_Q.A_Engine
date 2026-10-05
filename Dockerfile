FROM node:22-bookworm-slim AS system
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fonts-liberation \
     libglib2.0-0 libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libdbus-1-3 \
     libcups2 libexpat1 libxcb1 libxkbcommon0 libatspi2.0-0 libx11-6 \
     libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 \
     libcairo2 libpango-1.0-0 libasound2 \
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
RUN npm ci && npm run setup:browser
COPY --chown=node:node . ./
RUN npm run build

FROM system AS production
ENV NODE_ENV=production
ENV CLOAKBROWSER_AUTO_UPDATE=false
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /home/node/.cloakbrowser /home/node/.cloakbrowser
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
