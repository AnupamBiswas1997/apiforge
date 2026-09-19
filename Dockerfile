# =============================================================================
# Dockerfile — APIForge full-stack container
# =============================================================================
# Multi-stage build:
#   Stage 1 (builder): installs deps and builds the React client
#   Stage 2 (runtime): lean Node image that serves both API and static files
#
# The Express server serves the Vite-built static files from /app/client/dist
# at all non-/api routes in production mode.
# =============================================================================

# ── Stage 1: Build React client ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy and install client dependencies
COPY client/package*.json ./client/
RUN cd client && npm ci --prefer-offline

# Copy client source and build
COPY client/ ./client/
RUN cd client && npm run build

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install dumb-init for proper PID 1 signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy and install server dependencies (production only)
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production --prefer-offline

# Copy server source
COPY server/ ./server/

# Copy built client files from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Copy demo data seed
RUN mkdir -p /app/data/runs
COPY data/runs/demo.json ./data/runs/demo.json

# Copy env example (user should mount their own .env)
COPY .env.example ./.env.example

# Expose the backend port (default 3001 — configurable via PORT env var)
EXPOSE 3001

# Non-root user for security
RUN addgroup -g 1001 -S apiforge && adduser -S apiforge -u 1001
RUN chown -R apiforge:apiforge /app
USER apiforge

# Start the server (which serves static files in production)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
