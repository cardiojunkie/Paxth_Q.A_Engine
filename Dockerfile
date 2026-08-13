FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bullseye AS system

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libgbm1 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

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
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
