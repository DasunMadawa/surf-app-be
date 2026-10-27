# ── Build stage ───────────────────────────────────────────────
FROM node:22-alpine AS build

RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency manifests first (better layer caching)
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install all deps (including devDependencies for prisma generate)
RUN npm ci

# Copy source code
COPY . .

# ── Production stage ─────────────────────────────────────────
FROM node:22-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install production deps only + prisma generate (via postinstall)
RUN npm ci --omit=dev

# Copy generated Prisma client from build stage
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Copy application source
COPY src ./src/

# Expose the port (default 4000, configurable via env)
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-4000}/api/health || exit 1

# Run DB push (sync schema) then start the server
CMD ["sh", "-c", "npx prisma db push --skip-generate && node src/index.js"]
