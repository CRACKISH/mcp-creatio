# MCP Creatio Server

[![npm version](https://img.shields.io/npm/v/mcp-creatio)](https://www.npmjs.com/package/mcp-creatio)
[![Docker pulls](https://img.shields.io/docker/pulls/crackish/mcp-creatio)](https://hub.docker.com/r/crackish/mcp-creatio)
[![License](https://img.shields.io/github/license/CRACKISH/mcp-creatio)](LICENSE)

Model Context Protocol (MCP) server for Creatio (https://www.creatio.com/) to connect Claude Desktop, ChatGPT, GitHub Copilot, and other AI tools to Creatio data.

Also discoverable as:

- Creatio MCP server
- MCP server for Creatio CRM
- Model Context Protocol for Creatio

## Overview

- Exposes Creatio data as MCP tools for MCP-compatible clients (Claude Desktop, ChatGPT Connectors, GitHub Copilot)
- Supports reading, creating, updating, deleting records and inspecting schema
- Execute Creatio business processes with parameters
- Selectable data backend: Creatio DataService (default) or OData v4 (`CREATIO_CRUD_BACKEND`)

## Features

- **CRUD operations**: read, create, update, delete Creatio records
- **Schema discovery**: list entity sets and inspect entity schemas
- **Business processes**: run Creatio workflows with parameters
- **System settings**: read, write, and manage system setting metadata
- **Feature toggles**: manage `Feature` / `AdminUnitFeatureState` and refresh the feature cache. ⚠️ Only DB-backed features are reachable — features defined exclusively in `web.config` or other non-DB providers are invisible to MCP.
- **System operations**: manage `SysAdminOperation` and per-user/role grants (Creatio blocks these tables for OData modifications, so dedicated tools are provided)
- **Custom services**: invoke any configuration-package REST service (`/0/rest/<service>/<method>`) when no dedicated tool fits
- **AI assistant compatibility**: Claude Desktop, ChatGPT Connectors, GitHub Copilot
- **Three authentication modes**: Legacy login/password, OAuth2 client credentials, OAuth2 authorization code
- **Built-in OAuth server**: Automatic MCP client authentication
- **Docker ready**: Multi-arch images available

## Run Modes

This project supports two runtime modes:

### 1. CLI Mode (`stdio`)

Use this mode for MCP clients that launch a command directly (VS Code MCP, Claude Desktop, etc.).

- No HTTP endpoint needed
- Easiest local setup
- Supports Legacy auth and OAuth2 Client Credentials
- OAuth2 Authorization Code is **not** supported in `stdio` mode

Run directly from npm:

```bash
npx -y mcp-creatio@latest \
  --base-url https://your-creatio.com \
  --login your_login \
  --password your_password
```

`stdio` logs are disabled by default. To enable them, set `MCP_CREATIO_LOG_LEVEL` or pass `--log-level info`.

VS Code MCP config (command-based):

```json
{
	"creatio": {
		"command": "npx",
		"args": [
			"-y",
			"mcp-creatio@latest",
			"--base-url",
			"https://your-creatio.com",
			"--login",
			"your_login",
			"--password",
			"your_password"
		]
	}
}
```

Local repo command (without publishing):

```bash
npm run start:stdio -- --base-url https://your-creatio.com --login your_login --password your_password
```

### 2. Server Mode (`http`)

Use this mode when your client connects by URL (for example `http://localhost:3000/mcp`).

- Exposes HTTP endpoint: `/mcp`
- Required for OAuth2 Authorization Code flow
- Works well with Docker and remote deployments

Start server:

```bash
npm start
```

Then connect using URL:

```json
{
	"creatio": {
		"type": "http",
		"url": "http://localhost:3000/mcp"
	}
}
```

## Configuration

| Variable                     | Description                                                          |
| ---------------------------- | -------------------------------------------------------------------- |
| `CREATIO_BASE_URL`           | **Required**. Creatio instance URL (e.g. `https://your-creatio.com`) |
| `CREATIO_LOGIN`              | Username for legacy auth                                             |
| `CREATIO_PASSWORD`           | Password for legacy auth                                             |
| `CREATIO_CLIENT_ID`          | OAuth2 client credentials ID                                         |
| `CREATIO_CLIENT_SECRET`      | OAuth2 client credentials secret                                     |
| `CREATIO_ID_BASE_URL`        | Identity Service URL (if separate from main Creatio instance)        |
| `CREATIO_CODE_CLIENT_ID`     | OAuth2 authorization code client ID                                  |
| `CREATIO_CODE_CLIENT_SECRET` | OAuth2 authorization code client secret                              |
| `CREATIO_CODE_REDIRECT_URI`  | OAuth2 redirect URI (e.g. `http://localhost:3000/oauth/callback`)    |
| `CREATIO_CODE_SCOPE`         | OAuth2 scope (e.g. `offline_access ApplicationAccess_yourappguid`)   |
| `CREATIO_CRUD_BACKEND`       | CRUD data API: `dataservice` (default) or `odata`                    |
| `READONLY_MODE`              | Set `true` to disable create/update/delete operations                |
| `DISABLE_DATAFORGE`          | Set `true` to never probe/register DataForge tools (even if available) |
| `DISABLE_GLOBAL_SEARCH`      | Set `true` to never probe/register the Global Search tool            |
| `MCP_TRANSPORT`              | Docker only: `http` (default) or `stdio` — selects the run mode      |
| `PORT`                       | HTTP mode listen port (default `3000`)                               |
| `MCP_CREATIO_LOG_LEVEL`      | Log verbosity: `silent` (default), `error`, `warn`, `info`           |

> **Disabling optional capabilities.** DataForge and Global Search are auto-detected at
> startup and their tools registered only when the environment supports them. Set
> `DISABLE_DATAFORGE=true` / `DISABLE_GLOBAL_SEARCH=true` to skip the probe **and** the tools
> entirely — useful when a capability exists on the instance but you don't want to expose it
> (e.g. to keep the tool surface small / avoid spending tokens on it).

### CRUD backend

CRUD tools (`read`, `create`, `update`, `delete`, `list-entities`, `describe-entity`) run on a
selectable data API, chosen once per deployment via `CREATIO_CRUD_BACKEND`:

- **`dataservice`** (default) — Creatio's native DataService.
- **`odata`** — Creatio OData v4. Also enables the OData-only `read` extras (`filter` raw
  `$filter` string, `expand`).

Either way you query through the same tool surface: prefer the structured `filters` parameter —
it works unchanged on both backends.

## Authentication Modes

Choose one of three ways to authenticate with Creatio:

### 1. Legacy (Username/Password)

```bash
CREATIO_LOGIN=YourLogin
CREATIO_PASSWORD=YourPassword
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

**Note**: Currently uses in-memory storage for OAuth tokens. Tokens will be lost on server restart.

**Important**: OAuth2 Authorization Code requires **Server Mode (`http`)**.

**Priority**: Authorization Code > Client Credentials > Legacy

## MCP Client Authentication (HTTP Mode)

The server includes OAuth 2.1 Authorization Server for MCP clients (Claude Desktop, etc.). No additional setup required - clients authenticate automatically through standard OAuth flow.

## Examples

### Node.js (Legacy Auth)

```bash
export CREATIO_BASE_URL="https://your-creatio.com"
export CREATIO_LOGIN="YourLogin"
export CREATIO_PASSWORD="YourPassword"
npm start
```

### Docker

The image supports both transports, selected by `MCP_TRANSPORT` (default `http`).

**HTTP web service** (default — for remote/hosted/multi-client; required for the OAuth2
authorization-code flow):

```bash
docker run --rm -p 3000:3000 \
  -e CREATIO_BASE_URL="https://your-creatio.com" \
  -e CREATIO_LOGIN="YourLogin" \
  -e CREATIO_PASSWORD="YourPassword" \
  crackish/mcp-creatio
```

**stdio** (for a local client like Claude Desktop that spawns the process — note `-i`):

```bash
docker run -i --rm \
  -e MCP_TRANSPORT=stdio \
  -e CREATIO_BASE_URL="https://your-creatio.com" \
  -e CREATIO_LOGIN="YourLogin" \
  -e CREATIO_PASSWORD="YourPassword" \
  crackish/mcp-creatio
```

## Available Tools

| Tool                             | Description                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get-current-user-info`          | Fetch the Creatio contact details for the authenticated MCP user                                                                                         |
| `list-entities`                  | List all available entity sets                                                                                                                           |
| `describe-entity`                | Get schema for an entity (fields, types, keys). Routes through DataForge for richer column details when it is enabled, otherwise exact OData `$metadata` |
| `read`                           | Query records: filters, select, expand, ordering, pagination (skip/top) and total count                                                                  |
| `create`                         | Create a new record                                                                                                                                      |
| `update`                         | Update an existing record                                                                                                                                |
| `delete`                         | Delete a record                                                                                                                                          |
| `execute-process`                | Run a Creatio business process                                                                                                                           |
| `query-sys-settings`             | Read current values and metadata for one or more system settings                                                                                         |
| `set-sys-settings-value`         | Update one or more system setting values                                                                                                                 |
| `create-sys-setting`             | Create a new system setting (with optional initial value)                                                                                                |
| `update-sys-setting-definition`  | Modify system setting metadata (name, value type, cache flags, lookup reference)                                                                         |
| `refresh-feature-cache`          | Invalidate the in-memory feature-toggle cache. Call after editing `Feature` / `AdminUnitFeatureState` rows                                               |
| `upsert-admin-operation`         | Create or update a `SysAdminOperation` (system operation / permission). Required because OData modifications are blocked for this entity                 |
| `delete-admin-operation`         | Delete one or more `SysAdminOperation` rows (related grantee rows are cleaned up automatically)                                                          |
| `set-admin-operation-grantee`    | Grant or revoke a system operation for users/roles. Repeated calls update the existing row instead of duplicating                                        |
| `delete-admin-operation-grantee` | Remove specific grant rows by Id. Prefer `set-admin-operation-grantee` to flip allow ↔ deny                                                              |
| `call-configuration-service`     | Escape hatch: invoke any configuration-package REST service method by name. Use only when no dedicated tool covers the operation                         |

> **Note**: Previously documented `search`/`fetch` helper tools (for a specific connector workflow) have been removed as they are no longer required.

### Querying data with `read`

Ask for exactly the data you need — the AI doesn't have to know OData:

- **Filter any way** — equals / not-equals, ranges (`>`, `>=`, `<`, `<=`), text match (`contains`, `starts/ends with`), `AND` / `OR` groups, and "in this list".
- **Filter by related records naturally** — by name (`Contact/Name = "Andrew Baker"`) or by id; lookups just work, no special syntax to remember.
- **Sort** by any column, ascending or descending.
- **Paginate** with page size + offset, so large datasets come back in clean pages.
- **Count** — get the total number of matches in one call (e.g. "how many open cases does this account have?"), with or without the rows.
- **Pull in related data** in a single request (e.g. an order together with its account and contact).

### DataForge tools (registered only when DataForge is enabled)

DataForge is Creatio's AI-oriented semantic layer over the data model. These tools are **probed once at startup** and registered **only when the environment has DataForge configured** (a non-empty `DataForgeServiceUrl` system setting). When DataForge is absent the tools are not exposed at all, and `describe-entity` silently uses OData metadata — no wasted remote calls.

| Tool                            | Description                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dataforge-similar-tables`      | Semantic search: map a natural-language query to the Creatio tables that best match its meaning   |
| `dataforge-table-details`       | Like `dataforge-similar-tables` but returns richer per-table details for the best matches         |
| `dataforge-table-relationships` | Find the relationship path(s) between two tables (how they join) — useful before `read`/`$expand` |
| `dataforge-lookup-values`       | Fuzzy/semantic search for lookup values (resolve a phrase to the right lookup record Id)          |
| `dataforge-status`              | Report whether DataForge is online and whether the data model / lookups are synced                |

**Discovery → confirm → act:** use `dataforge-similar-tables` to find the right entity, then `describe-entity` for the authoritative field list, then `read`/`create`.

**Enabling DataForge** requires (on the Creatio side): the `DataForgeServiceUrl` system setting plus IdentityServer settings (`IdentityServerUrl`, `IdentityServerClientId`/`Secret`), the `DataForge*` feature toggles, and the `CanReadDataStructureColumnDetails` operation granted to the MCP user. Restart the app pool (or run the `DataStructureTransferFromCreatio` / `LookupsTransferFromCreatio` processes) to sync the model.

### Global Search tool (registered only when Global Search is enabled)

Global Search is Creatio's cross-entity, Elasticsearch-backed record search — the engine behind the UI search box. The tool is **probed once at startup** and registered **only when the environment has Global Search configured** (a non-empty `GlobalSearchUrl` system setting).

| Tool            | Description                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global-search` | Full-text search across all indexed entities (like the UI search). Input: `query`, optional `entities[]`/`limit`/`from`. Returns matched records with `entityName`, `id`, `columnValues`, highlighted `foundColumns`, plus `total`/`nextFrom` |

Differs from `read`: `read` needs an exact entity + OData filter; `global-search` is fuzzy and cross-entity — use it to locate a record when you don't know the entity. Calls `GlobalSearchService.Search`.

**Enabling Global Search** requires the `GlobalSearchUrl` (+ `GlobalSearchConfigServiceUrl`, `GlobalSearchIndexingApiUrl`) system settings and the `GlobalSearch` / `GlobalSearch_V2` feature toggles, with the section index built (Elasticsearch reachable).
