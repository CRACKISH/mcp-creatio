#!/bin/sh
# Select the MCP transport at container start:
#   MCP_TRANSPORT=http   (default) → HTTP web service on $PORT (Streamable HTTP at /mcp)
#   MCP_TRANSPORT=stdio            → MCP over stdio (run with `docker run -i …`)
# Both modes read connection config from the same env vars (CREATIO_BASE_URL, auth, …).
set -e

if [ "$MCP_TRANSPORT" = "stdio" ]; then
	exec node dist/cli.js "$@"
fi

exec node dist/index.js "$@"
