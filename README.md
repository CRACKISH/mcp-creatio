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
- Simple configuration via environment variables
- Runs locally or in Docker

## Setup

Set the environment variables (see next section), then start the server.

## Environment Variables

| Variable                | Description                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATIO_BASE_URL`      | Base URL of your Creatio instance (e.g. `https://your-creatio.com`)                                                                                                                |
| `CREATIO_LOGIN`         | Creatio username (legacy auth). Example: `Supervisor`. Required if not using OAuth2 client_credentials.                                                                            |
| `CREATIO_PASSWORD`      | Creatio password (legacy auth). Required if not using OAuth2 client_credentials.                                                                                                   |
| `CREATIO_CLIENT_ID`     | (Optional) OAuth2 client identifier — used for the `client_credentials` flow (when authenticating via Creatio Identity Service)                                                    |
| `CREATIO_CLIENT_SECRET` | (Optional) OAuth2 client secret — used with `CREATIO_CLIENT_ID` to obtain access tokens                                                                                            |
| `CREATIO_ID_BASE_URL`   | (Optional) Identity Service base URL for token requests (use when your `/connect/token` endpoint is served by a separate Identity Service host; e.g. `http://identity-host:5000` ) |
| `READONLY`              | (Optional) When set `true`, the server runs in read-only mode: `create`, `update`, and `delete` operations are disabled.                                                           |

### Authentication

The server supports two authentication modes for connecting to Creatio. Configure one of the following:

- Legacy (username/password): set `CREATIO_LOGIN` and `CREATIO_PASSWORD`.
- OAuth2 (client_credentials): set `CREATIO_CLIENT_ID` and `CREATIO_CLIENT_SECRET`. If the Identity Service token endpoint is hosted separately, set `CREATIO_ID_BASE_URL` to the host that exposes `/connect/token`.

If both modes are provided, the server will prefer OAuth2 when a valid `CREATIO_CLIENT_ID` and `CREATIO_CLIENT_SECRET` are present; otherwise it will fall back to the legacy username/password credentials.

### OAuth2 / Identity Service

This section covers Creatio Identity Service specifics and where to find setup documentation. The server can request access tokens using the OAuth2 `client_credentials` flow when `CREATIO_CLIENT_ID` and `CREATIO_CLIENT_SECRET` are configured.

See Creatio documentation for Identity Service / OAuth2 configuration:

https://academy.creatio.com/docs/8.x/dev/development-on-creatio-platform/integrations-and-api/authentication/oauth-2-0-authorization/identity-service-overview

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
# optional: if identity service is on a different host
$env:CREATIO_ID_BASE_URL="https://identity-host:5000"

npm run start
```

## Docker

Build and run (two examples: legacy and OAuth2).

### Docker — legacy (login/password)

```powershell
docker build -t mcp-creatio .
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_LOGIN="Supervisor" `
  -e CREATIO_PASSWORD="Supervisor" `
  mcp-creatio
```

### Docker — OAuth2 (client_credentials)

```powershell
docker build -t mcp-creatio .
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_CLIENT_ID="your_client_id" `
  -e CREATIO_CLIENT_SECRET="your_client_secret" `
  -e CREATIO_ID_BASE_URL="https://identity-host:5000" `
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
