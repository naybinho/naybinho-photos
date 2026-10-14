# ==============================================================================
# NayBinho Photos - Dockerfile
# ==============================================================================
FROM node:20-bookworm-slim

# Install system dependencies (ffmpeg for video thumbnails/streaming, curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Ensure required persistent and runtime directories exist
RUN mkdir -p /app/storage /app/models /app/logs /app/atualizacao

# Default environment variables
ENV NODE_ENV=production \
    PORT=9453 \
    STORAGE_PATH=/app/storage

# Expose port
EXPOSE 9453

# Healthcheck to monitor container status
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:9453/api/health || exit 1

# Start server
CMD ["node", "src/server.js"]
