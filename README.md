# MCP Creatio Server

Minimal Model Context Protocol (MCP) server for Creatio (https://www.creatio.com/).

## Overview

- Exposes Creatio data as MCP tools for MCP-compatible clients (e.g., ChatGPT Connectors, Claude MCP, GitHub Copilot)
- Supports reading, creating, updating, deleting records and inspecting schema
- Implementation note: currently uses Creatio OData v4 under the hood

## Features

- CRUD operations on Creatio entities (`read`, `create`, `update`, `delete`)
- Schema discovery (`list-entities`, `describe-entity`)
- OpenAI GPT Connector MCP compatibility (`search`, `fetch`)
- **Three Creatio authentication modes**:
    1. Username/password authentication
    2. OAuth 2.0 client credentials flow
    3. OAuth 2.0 authorization code flow
- **OAuth 2.1 Authorization Server**: Automatic OAuth server for MCP clients
- Simple configuration via environment variables
- Runs locally or in Docker

## Setup

Set the environment variables (see next section), then start the server.

## Environment Variables

| Variable                     | Description                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATIO_BASE_URL`           | Base URL of your Creatio instance (e.g. `https://your-creatio.com`)                                                                                                                |
| `CREATIO_LOGIN`              | Creatio username (legacy auth). Example: `Supervisor`. Required if not using OAuth2 client_credentials.                                                                            |
| `CREATIO_PASSWORD`           | Creatio password (legacy auth). Required if not using OAuth2 client_credentials.                                                                                                   |
| `CREATIO_CLIENT_ID`          | (Optional) OAuth2 client identifier — used for the `client_credentials` flow (when authenticating via Creatio Identity Service)                                                    |
| `CREATIO_CLIENT_SECRET`      | (Optional) OAuth2 client secret — used with `CREATIO_CLIENT_ID` to obtain access tokens                                                                                            |
| `CREATIO_ID_BASE_URL`        | (Optional) Identity Service base URL for token requests (use when your `/connect/token` endpoint is served by a separate Identity Service host; e.g. `http://identity-host:5000` ) |
| `CREATIO_CODE_CLIENT_ID`     | (Optional) OAuth2 authorization code client ID                                                                                                                                     |
| `CREATIO_CODE_CLIENT_SECRET` | (Optional) OAuth2 authorization code client secret                                                                                                                                 |
| `CREATIO_CODE_REDIRECT_URI`  | (Optional) OAuth2 authorization code redirect URI                                                                                                                                  |
| `CREATIO_CODE_SCOPE`         | (Optional) OAuth2 authorization code scope                                                                                                                                         |
| `READONLY_MODE`              | (Optional) When set `true`, the server runs in read-only mode: `create`, `update`, and `delete` operations are disabled.                                                           |

### Authentication

The server supports three Creatio authentication modes:

1. **Username/Password**: set `CREATIO_LOGIN` and `CREATIO_PASSWORD`
2. **OAuth2 Client Credentials**: set `CREATIO_CLIENT_ID` and `CREATIO_CLIENT_SECRET`. If the Identity Service token endpoint is hosted separately, also set `CREATIO_ID_BASE_URL`
3. **OAuth2 Authorization Code**: set `CREATIO_CODE_CLIENT_ID`, `CREATIO_CODE_CLIENT_SECRET`, `CREATIO_CODE_REDIRECT_URI`, `CREATIO_CODE_SCOPE`

If multiple modes are configured, the server will prefer OAuth2 Code > OAuth2 Client Credentials > Username/Password.

### OAuth for MCP Clients

The server includes a built-in OAuth 2.1 Authorization Server that automatically handles MCP client authentication. MCP clients can connect using standard OAuth 2.1 flow with PKCE.

**Automatic Setup**: The server automatically:

- Registers common MCP clients (Claude Desktop, VS Code extensions, etc.)
- Provides OAuth 2.1 endpoints per [MCP specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization#2-4-dynamic-client-registration)
- Handles authorization flow with Creatio backend

**For MCP Client Developers**: See the [Model Context Protocol Authorization specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization) for implementation details.

## Run

### Using login/password

```powershell
$env:CREATIO_BASE_URL="https://your-creatio.com"
$env:CREATIO_LOGIN="Supervisor"
$env:CREATIO_PASSWORD="Supervisor"
npm run start
```

### Using OAuth2 (client credentials)

```powershell
$env:CREATIO_BASE_URL="https://your-creatio.com"
$env:CREATIO_CLIENT_ID="your_client_id"
$env:CREATIO_CLIENT_SECRET="your_client_secret"
npm run start
```

## Docker

Example with username/password authentication:

```powershell
docker build -t mcp-creatio .
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_LOGIN="Supervisor" `
  -e CREATIO_PASSWORD="Supervisor" `
  mcp-creatio
```

CI/CD:

- This repository publishes a multi-arch image (`linux/amd64`, `linux/arm64`) to Docker Hub at `crackish/mcp-creatio` using GitHub Actions.
- Triggers: on push to `main`, tags `v*.*.*`, or manual `workflow_dispatch`.

## Tools (short)

- `list-entities` — list entity sets
- `describe-entity` — schema for an entity set (type, keys, properties)
- `read` — query records: `entity`, optional `$filter`, `$select`, `$top`
- `create` — create one record: `entity`, `data`
- `update` — update one record: `entity`, `id`, `data`
- `delete` — delete one record: `entity`, `id`
- `search` — simple search; mainly for OpenAI GPT Connector MCP
- `fetch` — fetch by `EntitySet:GUID`; mainly for OpenAI GPT Connector MCP
