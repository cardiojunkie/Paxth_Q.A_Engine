FROM node:22-bookworm-slim AS system
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv xvfb xauth xfonts-base fonts-liberation \
     libglib2.0-0 libnss3 libatk-bridge2.0-0 libdbus-1-3 libcups2 libxcb1 libxkbcommon0 \
     libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libcairo2 libpango-1.0-0 libasound2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app && chown node:node /app
USER node
WORKDIR /app
ENV CLOAKBROWSER_VERSION=146.0.7680.177.5 CLOAKBROWSER_AUTO_UPDATE=false

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
ARG CLOAKBROWSER_VERSION=146.0.7680.177.5
ENV CLOAKBROWSER_VERSION=${CLOAKBROWSER_VERSION}
RUN npm run setup:scraper && npm run build

FROM system AS production
ARG CLOAKBROWSER_VERSION=146.0.7680.177.5
ENV NODE_ENV=production SCRAPER_PYTHON=/app/.venv/bin/python CLOAKBROWSER_VERSION=${CLOAKBROWSER_VERSION}
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/.venv ./.venv
COPY --from=build --chown=node:node /app/scraper ./scraper
COPY --from=build --chown=node:node /home/node/.cloakbrowser /home/node/.cloakbrowser
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
