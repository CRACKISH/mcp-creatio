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

| Variable           | Required | Description                                                         |
| ------------------ | -------- | ------------------------------------------------------------------- |
| `CREATIO_BASE_URL` | ✅       | Base URL of your Creatio instance (e.g. `https://your-creatio.com`) |
| `CREATIO_LOGIN`    | —        | Username (required if no API key)                                   |
| `CREATIO_PASSWORD` | —        | Password (required if no API key)                                   |
| `CREATIO_API_KEY`  | —        | API key (alternative to login/password)                             |

## Run

### Using login/password

```powershell
$env:CREATIO_BASE_URL="https://your-creatio.com"
$env:CREATIO_LOGIN="Supervisor"
$env:CREATIO_PASSWORD="Supervisor"
npm run start
```

### Using API key

```powershell
$env:CREATIO_BASE_URL="https://your-creatio.com"
$env:CREATIO_API_KEY="your_api_key_here"
npm run start
```

## Docker

Build and run:

### Docker (login/password)

```powershell
docker build -t mcp-creatio .
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_LOGIN="Supervisor" `
  -e CREATIO_PASSWORD="Supervisor" `
  mcp-creatio
```

### Docker (API key)

```powershell
docker build -t mcp-creatio .
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_API_KEY="your_api_key_here" `
  mcp-creatio
```

Prebuilt image from Docker Hub:

### Prebuilt image (login/password)

```powershell
docker pull crackish/mcp-creatio:latest
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_LOGIN="Supervisor" `
  -e CREATIO_PASSWORD="Supervisor" `
  crackish/mcp-creatio:latest
```

### Prebuilt image (API key)

```powershell
docker pull crackish/mcp-creatio:latest
docker run --rm -p 3000:3000 `
  -e CREATIO_BASE_URL="https://your-creatio.com" `
  -e CREATIO_API_KEY="your_api_key_here" `
  crackish/mcp-creatio:latest
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

