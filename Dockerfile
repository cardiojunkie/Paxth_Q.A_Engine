FROM node:22-bookworm-slim AS system

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    python3 \
    python3-venv \
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
  && python3 -m venv /opt/crawl4ai \
  && mkdir -p /app \
  && chown -R node:node /app /opt/crawl4ai

ENV CRAWL4AI_PYTHON=/opt/crawl4ai/bin/python
USER node
WORKDIR /app

FROM system AS build
COPY --chown=node:node package*.json ./
RUN npm ci
COPY --chown=node:node . ./
RUN npm run build

FROM system AS production
ENV NODE_ENV=production
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node scraper/requirements.txt ./scraper/requirements.txt
RUN /opt/crawl4ai/bin/python -m pip install --no-cache-dir -r scraper/requirements.txt \
  && /opt/crawl4ai/bin/python -m playwright install chromium \
  && /opt/crawl4ai/bin/python -c "import importlib.metadata; from crawl4ai import AsyncWebCrawler; assert importlib.metadata.version('crawl4ai') == '0.9.3'; from playwright.sync_api import sync_playwright; p = sync_playwright().start(); browser = p.chromium.launch(headless=True); browser.close(); p.stop()"
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node scraper ./scraper
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
