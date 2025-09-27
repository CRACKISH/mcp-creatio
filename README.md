# MCP Creatio Server

Model Context Protocol (MCP) server for Creatio (https://www.creatio.com/) - connect Claude Desktop, ChatGPT, and other AI tools to your Creatio data.

## Overview

- Exposes Creatio data as MCP tools for MCP-compatible clients (Claude Desktop, ChatGPT Connectors, GitHub Copilot)
- Supports reading, creating, updating, deleting records and inspecting schema
- Uses Creatio OData v4 API under the hood

## Features

- **CRUD operations**: `read`, `create`, `update`, `delete` Creatio records
- **Schema discovery**: `list-entities`, `describe-entity`
- **AI assistant compatibility**: Claude Desktop, ChatGPT Connectors, GitHub Copilot
- **Three authentication modes**: Legacy login/password, OAuth2 client credentials, OAuth2 authorization code
- **Built-in OAuth server**: Automatic MCP client authentication
- **Docker ready**: Multi-arch images available

## Quick Start

1. Set environment variables (see below)
2. Run: `npm start` or use Docker

## Configuration

| Variable                     | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `CREATIO_BASE_URL`           | **Required**. Creatio instance URL (e.g. `https://your-creatio.com`) |
| `CREATIO_LOGIN`              | Username for legacy auth (e.g. `Supervisor`)                         |
| `CREATIO_PASSWORD`           | Password for legacy auth                                             |
| `CREATIO_CLIENT_ID`          | OAuth2 client credentials ID                                         |
| `CREATIO_CLIENT_SECRET`      | OAuth2 client credentials secret                                     |
| `CREATIO_ID_BASE_URL`        | Identity Service URL (if separate from main Creatio instance)        |
| `CREATIO_CODE_CLIENT_ID`     | OAuth2 authorization code client ID                                  |
| `CREATIO_CODE_CLIENT_SECRET` | OAuth2 authorization code client secret                              |
| `CREATIO_CODE_REDIRECT_URI`  | OAuth2 redirect URI (e.g. `http://localhost:3000/oauth/callback`)    |
| `CREATIO_CODE_SCOPE`         | OAuth2 scope (e.g. `offline_access ApplicationAccess_yourappguid`)   |
| `READONLY_MODE`              | Set `true` to disable create/update/delete operations                |

## Authentication Modes

Choose one of three ways to authenticate with Creatio:

### 1. Legacy (Username/Password)

```bash
CREATIO_LOGIN=Supervisor
CREATIO_PASSWORD=Supervisor
```

### 2. OAuth2 Client Credentials

For server-to-server authentication. [Setup guide →](https://academy.creatio.com/docs/8.x/dev/development-on-creatio-platform/integrations-and-api/authentication/oauth-2-0-authorization/identity-service-overview)

```bash
CREATIO_CLIENT_ID=your_client_id
CREATIO_CLIENT_SECRET=your_client_secret
```

### 3. OAuth2 Authorization Code

For user-delegated access with web authorization. [Setup guide →](https://academy.creatio.com/docs/8.x/dev/development-on-creatio-platform/integrations-and-api/authentication/oauth-2-0-authorization/authorization-code-grant)

```bash
CREATIO_CODE_CLIENT_ID=your_client_id
CREATIO_CODE_CLIENT_SECRET=your_client_secret
CREATIO_CODE_REDIRECT_URI=http://localhost:3000/oauth/callback
CREATIO_CODE_SCOPE="offline_access ApplicationAccess_yourappguid"
```

**Priority**: Authorization Code > Client Credentials > Legacy

## MCP Client Authentication

The server includes OAuth 2.1 Authorization Server for MCP clients (Claude Desktop, etc.). No additional setup required - clients authenticate automatically through standard OAuth flow.

## Examples

### Node.js (Legacy Auth)

```bash
export CREATIO_BASE_URL="https://your-creatio.com"
export CREATIO_LOGIN="Supervisor"
export CREATIO_PASSWORD="Supervisor"
npm start
```

### Docker (Legacy Auth)

```bash
docker run --rm -p 3000:3000 \
  -e CREATIO_BASE_URL="https://your-creatio.com" \
  -e CREATIO_LOGIN="Supervisor" \
  -e CREATIO_PASSWORD="Supervisor" \
  crackish/mcp-creatio
```

## Available Tools

| Tool              | Description                                 |
| ----------------- | ------------------------------------------- |
| `list-entities`   | List all available entity sets              |
| `describe-entity` | Get schema for entity (fields, types, keys) |
| `read`            | Query records with optional filters         |
| `create`          | Create new record                           |
| `update`          | Update existing record                      |
| `delete`          | Delete record                               |
| `search`          | Simple text search across entities          |
| `fetch`           | Get specific record by EntitySet:GUID       |
