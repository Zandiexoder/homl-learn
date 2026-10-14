# Video renderer: Remotion + headless Chromium. Run it on a network with no internet access,
# because it executes scene code written by the language model.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
      fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /renderer
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Download Remotion's headless browser at build time; the running container has no internet.
RUN node -e "import('@remotion/renderer').then((m) => m.ensureBrowser())"
COPY tsconfig.json server.mjs ./
COPY src ./src
ENV DATA_DIR=/data PORT=3100
EXPOSE 3100
CMD ["node", "server.mjs"]
