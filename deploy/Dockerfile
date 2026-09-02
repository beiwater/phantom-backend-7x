# Multi-stage production container image for SimCompanies Private Server
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

# Copy project files
COPY package.json ./
COPY server ./server
COPY frontend-original ./frontend-original
COPY scripts ./scripts

# Create data volume directory and non-root user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# Health check probe using Node
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "--experimental-strip-types", "server/index.ts"]
