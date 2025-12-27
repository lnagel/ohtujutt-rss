# Multi-stage build for efficiency
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (omit dev dependencies)
RUN npm ci --omit=dev && \
    npm cache clean --force

# Production image
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs wrangler.toml ./
COPY --chown=nodejs:nodejs src ./src

# Switch to non-root user
USER nodejs

# Expose port for wrangler dev
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8787/', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run wrangler dev on all interfaces
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787", "--local"]
