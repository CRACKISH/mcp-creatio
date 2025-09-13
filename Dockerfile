# Minimal Dockerfile for MCP Creatio Server
# Builds and runs with ts-node (no separate build step)

FROM node:20-alpine AS base

# App directory
WORKDIR /app

# Install production and dev deps (ts-node, types)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source
COPY . .

# Environment (override at runtime)
ENV PORT=3000

# Expose MCP HTTP port
EXPOSE 3000

# Start the server (ts-node)
CMD ["npm", "run", "start"]
