FROM node:26-alpine

# Install dumb-init
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install deps
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code
COPY --chown=node:node src ./src

# Switch to non-root user
USER 1000

# HTTP port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:8787/health').then(r => process.exit(r.ok ? 0 : 1))"

# Signal handling
ENTRYPOINT ["dumb-init", "--"]

# Run server
CMD ["node", "src/index.js"]
