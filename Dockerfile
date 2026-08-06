# Multi-stage Dockerfile for StudyHub — web + bot + Litestream replication.
# Build: docker build -t studyhub .
# Run:   docker run -p 3000:3000 --env-file .env -v $(pwd)/storage:/app/storage studyhub

FROM node:20-alpine AS base
RUN apk add --no-cache curl tar
WORKDIR /app

# Install Litestream
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64-static.tar.gz \
  | tar -xz -C /usr/local/bin

# Copy package files and install deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source (TypeScript, runs via --import tsx)
COPY tsconfig.json litestream.yml ./
COPY src ./src
COPY bot ./bot
COPY public ./public
COPY scripts ./scripts

# Generate PWA icons
RUN node scripts/gen-icons.mjs

# Runtime
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Litestream restores DB from R2 on boot, replicates continuously, then runs web+bot
CMD ["litestream", "replicate", "-config", "litestream.yml", "-exec", "npm run start"]
