# ============================================================
# Stage 1: Build
# ============================================================
FROM node:20-bookworm-slim AS builder

# Install pnpm + native build tools (required by better-sqlite3)
RUN npm install -g pnpm && \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Backend dependencies ---
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- WebUI dependencies ---
COPY webui/package.json webui/
RUN cd webui && npm install

# --- Source files ---
COPY . .

# --- Build backend (vite → dist/) + WebUI (svelte → webui/build/) ---
RUN pnpm run build:all

# Remove dev dependencies to slim down node_modules before copying
RUN pnpm prune --prod

# ============================================================
# Stage 2: Runtime
# ============================================================
FROM node:20-bookworm-slim AS runtime

# Install Chromium (for Puppeteer headless) + CJK fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium \
        fonts-noto-cjk \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Point puppeteer-core at the system Chromium
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copy production node_modules (includes compiled better-sqlite3 .node binary)
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/webui/build ./webui/build

# Copy built-in plugins and static pages
COPY plugins ./plugins
COPY statics ./statics

# Copy root package.json (node may need it for ESM resolution)
COPY package.json ./

EXPOSE 3751

# Mount user data directory (.rssany/) as a volume so it persists across container restarts
VOLUME ["/app/.rssany"]

CMD ["node", "dist/index.js"]
