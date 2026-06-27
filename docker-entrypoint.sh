#!/bin/sh
# Select the MCP transport at container start:
#   CREATIO_MCP_TRANSPORT=http   (default) → HTTP web service on the port (Streamable HTTP at /mcp)
#   CREATIO_MCP_TRANSPORT=stdio            → MCP over stdio (run with `docker run -i …`)
# Both modes read connection config from the same env vars (CREATIO_BASE_URL, auth, …).
set -e

# Canonical CREATIO_MCP_TRANSPORT; fall back to the deprecated MCP_TRANSPORT for compatibility.
TRANSPORT="${CREATIO_MCP_TRANSPORT:-$MCP_TRANSPORT}"

if [ "$TRANSPORT" = "stdio" ]; then
	exec node dist/cli.js "$@"
fi

exec node dist/index.js "$@"
