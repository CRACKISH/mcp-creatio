# Multi-stage build for the MCP Creatio Server.
# Build stage compiles TypeScript; the runtime image carries only prod deps + dist.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Transport: "http" (default, web service) or "stdio" (run with `docker run -i …`).
ENV CREATIO_MCP_TRANSPORT=http
ENV CREATIO_MCP_PORT=3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Used in HTTP mode; ignored for stdio.
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
