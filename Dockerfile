FROM node:22-bookworm-slim AS system

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app \
  && chown node:node /app

USER node
WORKDIR /app

FROM system AS build
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . ./
RUN npm run build

FROM system AS production
ENV NODE_ENV=production
ENV CLOAKBROWSER_AUTO_UPDATE=false
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev \
  && npx --no-install cloakbrowser install \
  && node --input-type=module -e "import { launch } from 'cloakbrowser'; const browser = await launch({ headless: true }); await browser.close();"
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
