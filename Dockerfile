FROM node:25-slim

# Install dumb-init and ca-certificates for HTTPS
RUN apt-get update && \
    apt-get install -y --no-install-recommends dumb-init ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -r -u 1001 -g nodejs nodejs

WORKDIR /app

# Copy package files and install (no production deps currently, but good practice)
COPY --chown=nodejs:nodejs package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application code
COPY --chown=nodejs:nodejs src ./src

# Switch to non-root user
USER nodejs

# Expose HTTP port
EXPOSE 8787

# Health check using native fetch
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8787/').then(r => process.exit(r.ok ? 0 : 1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run the Node.js server directly
CMD ["node", "src/index.js"]
