# MCP Creatio Server

[![npm version](https://img.shields.io/npm/v/mcp-creatio)](https://www.npmjs.com/package/mcp-creatio)
[![Docker pulls](https://img.shields.io/docker/pulls/crackish/mcp-creatio)](https://hub.docker.com/r/crackish/mcp-creatio)
[![License](https://img.shields.io/github/license/CRACKISH/mcp-creatio)](LICENSE)

Model Context Protocol (MCP) server for [Creatio](https://www.creatio.com/) — connect Claude
Desktop, ChatGPT, GitHub Copilot, and other AI tools to your Creatio data, schema, and processes.

> Also discoverable as: _Creatio MCP server_ · _MCP server for Creatio CRM_ · _Model Context
> Protocol for Creatio_.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Configuration](#configuration)
- [CRUD backend](#crud-backend)
- [Tools](#tools)
- [Docker](#docker)

---

## What it does

- **CRUD + schema** — read, create, update, delete records; list entity sets; inspect schemas.
- **Business processes** — run Creatio workflows with parameters.
- **System settings** — read, write, and manage system-setting metadata.
- **Feature toggles** — manage `Feature` / `AdminUnitFeatureState` and refresh the feature cache.
  ⚠️ Only DB-backed features are reachable (those defined solely in `web.config` are invisible).
- **System operations** — manage `SysAdminOperation` and per-user/role grants (OData blocks these
  tables, so dedicated tools are provided).
- **Custom services** — invoke any configuration-package REST service (`/0/rest/<service>/<method>`)
  when no dedicated tool fits.
- **Selectable data backend** — Creatio DataService (default) or OData v4 (`CREATIO_MCP_CRUD_BACKEND`).
- **Optional semantic layers** — DataForge and Global Search tools auto-register when the instance
  supports them.

Works with Claude Desktop, ChatGPT Connectors, GitHub Copilot, and any MCP-compatible client.

---

## Quick start

The server runs in one of two transports. **Pick by how your client connects**, then pick an
[authentication](#authentication) method.

### stdio (single-user, local)

For clients that launch a command directly (VS Code MCP, Claude Desktop). Single Creatio identity
per process; authenticate with **client credentials** or **legacy** login.

```bash
npx -y mcp-creatio@latest \
  --base-url https://your-creatio.com \
  --login your_login --password your_password
```

```jsonc
// VS Code / Claude Desktop (command-based)
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
			"your_password",
		],
	},
}
```

> stdio logs are silent by default — enable with `--log-level info` or `CREATIO_MCP_LOG_LEVEL`.

### HTTP (multi-user, hosted)

For clients that connect by URL, and for multi-user / hosted deployments. This transport serves the
`broker`, `delegated`, and `gateway` auth modes (see [Authentication](#authentication)).

```bash
npm start                     # serves http://localhost:3000/mcp
```

```jsonc
{ "creatio": { "type": "http", "url": "http://localhost:3000/mcp" } }
```

---

## Authentication

One unified selector — `CREATIO_MCP_AUTH_MODE` — picks how a request proves its Creatio identity.
When unset it is inferred from the credentials you provide. The HTTP modes are multi-user; stdio is
single-user.

| Mode                     | Transport    | How identity is established                                                                     | When to use                                                                                  |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **`broker`**             | HTTP         | The MCP is its own OAuth server: it walks the user through Creatio login and holds their tokens | **Standalone direct clients** (Claude Desktop / ChatGPT) — connect → authorize → work as you |
| **`delegated`**          | HTTP         | The client brings a Creatio token; the MCP validates expiry and passes it through               | Clients that obtain a Creatio token themselves / behind an external AS                       |
| **`gateway`**            | HTTP         | A trusted Control-Plane injects the token per request                                           | Behind the Creatio.ai Control-Plane (multi-tenant)                                           |
| **`client_credentials`** | stdio / HTTP | One service account (`client_id` / `secret`)                                                    | M2M / single service identity                                                                |
| **`legacy`**             | stdio / HTTP | One user (login / password)                                                                     | Local / legacy instances                                                                     |

> The MCP issues Creatio tokens of its own only in `broker` mode (where it must, to drive the
> login). `delegated`/`gateway` pass tokens through; `client_credentials`/`legacy` use a single
> server-side identity.

> **Trust model.** `delegated` and `gateway` are **fully-trusted-environment** modes: the MCP does
> NOT cryptographically verify the incoming Bearer — Creatio remains the authority and rejects bad
> tokens on the API call — so the request's `userKey` is an unverified, logging-only identity. Run
> them only where the caller is trusted (`gateway`: behind the Creatio.ai Control-Plane;
> `delegated`: a trusted client on a trusted network / your own proxy). For an **untrusted direct
> external client** that needs the MCP itself to verify identity, use `broker` — there the MCP
> issues and verifies its own audience-bound (`aud`/`iss`) tokens.

### `broker` — the "connect & authorize" UX for direct clients

The MCP acts as an OAuth 2.1 authorization server for its clients (dynamic registration, authorize,
token) and brokers the actual login to Creatio via authorization_code with PKCE. The client only
ever talks to the MCP, so this works even though Creatio offers no dynamic client registration — and
the client never needs to reach Creatio's TLS endpoint directly.

The tokens the MCP issues to clients are **audience-bound** (`aud` = this deployment's `/mcp`
resource, `iss` = its origin), so a token minted by one deployment is rejected by another even when
they share a secret. The MCP also supports the **`refresh_token` grant** (rotating), so a client
gets a fresh access token without re-running the browser flow every hour — for as long as the MCP
still holds that user's Creatio tokens.

```bash
CREATIO_MCP_AUTH_MODE=broker
CREATIO_CLIENT_ID=your_creatio_oauth_app_client_id   # the Creatio "On behalf of a user" app
CREATIO_MCP_JWT_SECRET=a-long-random-secret-min-32   # signs the tokens the MCP issues to clients
# CREATIO_CLIENT_SECRET=...                            # only for a confidential Creatio app (omit for public/PKCE)
```

> **`CREATIO_MCP_JWT_SECRET`** must be **at least 32 characters** (HS256 security rests entirely on
> its entropy — a shorter value is rejected at startup). In **production** (`NODE_ENV=production`) it
> is **required** (the server fails closed if unset). Outside production an unset secret yields a
> random one so a local run needs no setup — but the tokens the MCP issues are then invalidated on
> every restart and are not valid across multiple instances, so **set a stable secret for production
> or any horizontally-scaled deployment.**

Register the Creatio app in System Designer → _OAuth 2.0 applications_ → _On behalf of a user_, and
add the MCP callback (`http://localhost:3000/oauth/callback` for a local run) to its redirect URIs.

### `delegated` (default when nothing else is set)

Pure resource server: each `/mcp` request must carry a Creatio access token; the MCP advertises the
authorization server (Creatio Identity) via **RFC 9728** and challenges unauthenticated requests, so
the client logs in directly against Creatio. Needs no server-side credentials. The token is passed
through unverified (Creatio is the authority) — a **trusted-environment** mode (see the trust note
above).

### `gateway`

A trusted fronting service (Creatio.ai Control-Plane) injects the Bearer; the MCP trusts and uses
it. The optional `X-Creatio-Base-Url` header routes a request to a specific Creatio instance
(multi-tenant) — honored only in this mode. Because that override decides where the request's Bearer
is sent, it is validated: set **`CREATIO_MCP_ALLOWED_BASE_URLS`** (comma-separated origins) to
restrict it to your tenants. When unset, any `http(s)` host is accepted (trusting the gateway) except
the cloud-metadata link-local address, which is always blocked (SSRF guard).

### `client_credentials` / `legacy`

```bash
CREATIO_CLIENT_ID=your_client_id          # client_credentials
CREATIO_CLIENT_SECRET=your_client_secret

CREATIO_LOGIN=YourLogin                   # legacy
CREATIO_PASSWORD=YourPassword
```

> **Precedence:** an explicit `CREATIO_MCP_AUTH_MODE` always wins. When unset, the mode is inferred:
> legacy (login+password) → client_credentials (id+secret) → delegated. `broker`, `delegated` and
> `gateway` require HTTP transport (stdio has no incoming web request to authenticate).

---

## Configuration

Grouped from essential to optional. **`CREATIO_BASE_URL` is the only always-required value** —
nothing works without it; the rest depend on the auth method and the features you enable.

### Connection (required)

| Variable           | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `CREATIO_BASE_URL` | **Required.** Creatio instance URL (e.g. `https://your-creatio.com`) |

### Authentication (pick one method — see [Authentication](#authentication))

| Variable                             | Mode          | Description                                                                                                                                                                |
| ------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATIO_MCP_AUTH_MODE`              | any           | `broker` \| `delegated` \| `gateway` \| `client_credentials` \| `legacy`. Unset ⇒ inferred (legacy → client_credentials → delegated)                                       |
| `CREATIO_CLIENT_ID`                  | broker / M2M  | Creatio OAuth app client id (the brokered app, or the M2M account)                                                                                                         |
| `CREATIO_CLIENT_SECRET`              | broker? / M2M | Required for client_credentials; optional for a confidential broker app (omit for public/PKCE)                                                                             |
| `CREATIO_MCP_JWT_SECRET`             | broker        | Secret signing the tokens the MCP issues to clients. **Min 32 chars; required in production.** Random if unset outside prod (set a stable value for prod / multi-instance) |
| `CREATIO_MCP_ALLOWED_BASE_URLS`      | gateway       | _Optional_ — comma-separated allowlist of Creatio origins the `X-Creatio-Base-Url` override may target (SSRF guard). Unset ⇒ any http(s) host except cloud-metadata        |
| `CREATIO_LOGIN` / `CREATIO_PASSWORD` | legacy        | Username / password                                                                                                                                                        |
| `CREATIO_ID_BASE_URL`                | any           | _Optional_ — Identity Service URL; defaults to deriving from `CREATIO_BASE_URL`                                                                                            |

### Data & behavior (optional)

| Variable                            | Description                                       |
| ----------------------------------- | ------------------------------------------------- |
| `CREATIO_MCP_CRUD_BACKEND`          | CRUD data API: `dataservice` (default) or `odata` |
| `CREATIO_MCP_READONLY`              | `true` disables create/update/delete operations   |
| `CREATIO_MCP_DISABLE_DATAFORGE`     | `true` skips the DataForge probe **and** tools    |
| `CREATIO_MCP_DISABLE_GLOBAL_SEARCH` | `true` skips the Global Search probe **and** tool |

### Transport & runtime (optional)

| Variable                | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `CREATIO_MCP_TRANSPORT` | Docker only: `http` (default) or `stdio`                   |
| `CREATIO_MCP_PORT`      | HTTP listen port (default `3000`; `PORT` also accepted)    |
| `CREATIO_MCP_LOG_LEVEL` | Log verbosity: `silent` (default), `error`, `warn`, `info` |

> **Disabling optional capabilities.** DataForge and Global Search are auto-detected at startup and
> registered only when supported. Set `CREATIO_MCP_DISABLE_DATAFORGE=true` /
> `CREATIO_MCP_DISABLE_GLOBAL_SEARCH=true` to skip the probe and the tools — useful to keep the tool
> surface small even when the capability exists.

---

## CRUD backend

CRUD tools (`read`, `create`, `update`, `delete`, `list-entities`, `describe-entity`) run on a
selectable data API, chosen once per deployment via `CREATIO_MCP_CRUD_BACKEND`:

- **`dataservice`** (default) — Creatio's native DataService.
- **`odata`** — Creatio OData v4. Also enables the OData-only `read` extras (raw `$filter`, `expand`).

Either way you query through the same tool surface: prefer the structured `filters` parameter — it
works unchanged on both backends.

---

## Tools

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

### Querying data with `read`

Ask for exactly the data you need — the AI doesn't have to know OData:

- **Filter any way** — equals / not-equals, ranges, text match (`contains`, `starts/ends with`),
  `AND` / `OR` groups, and "in this list".
- **Filter by related records naturally** — by name (`Contact/Name = "Andrew Baker"`) or by id.
- **Sort**, **paginate** (page size + offset), and **count** matches in one call.
- **Pull in related data** in a single request (e.g. an order with its account and contact).

### DataForge tools (registered only when DataForge is enabled)

DataForge is Creatio's AI-oriented semantic layer over the data model. These tools are **probed once**
and registered **only when the environment has DataForge configured** (a non-empty
`DataForgeServiceUrl` system setting). When DataForge is absent the tools are not exposed, and
`describe-entity` silently uses OData metadata.

| Tool                            | Description                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dataforge-similar-tables`      | Semantic search: map a natural-language query to the Creatio tables that best match its meaning   |
| `dataforge-table-details`       | Like `dataforge-similar-tables` but returns richer per-table details for the best matches         |
| `dataforge-table-relationships` | Find the relationship path(s) between two tables (how they join) — useful before `read`/`$expand` |
| `dataforge-lookup-values`       | Fuzzy/semantic search for lookup values (resolve a phrase to the right lookup record Id)          |
| `dataforge-status`              | Report whether DataForge is online and whether the data model / lookups are synced                |

**Discovery → confirm → act:** use `dataforge-similar-tables` to find the right entity, then
`describe-entity` for the authoritative field list, then `read`/`create`.

**Enabling DataForge** (Creatio side): the `DataForgeServiceUrl` system setting plus IdentityServer
settings (`IdentityServerUrl`, `IdentityServerClientId`/`Secret`), the `DataForge*` feature toggles,
and the `CanReadDataStructureColumnDetails` operation granted to the MCP user. Restart the app pool
(or run `DataStructureTransferFromCreatio` / `LookupsTransferFromCreatio`) to sync the model.

### Global Search tool (registered only when Global Search is enabled)

Global Search is Creatio's cross-entity, Elasticsearch-backed record search — the engine behind the
UI search box. Probed once, registered only when `GlobalSearchUrl` is configured.

| Tool            | Description                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global-search` | Full-text search across all indexed entities. Input: `query`, optional `entities[]`/`limit`/`from`. Returns matched records with `entityName`, `id`, `columnValues`, `total`/`nextFrom` |

Differs from `read`: `read` needs an exact entity + filter; `global-search` is fuzzy and
cross-entity — use it to locate a record when you don't know the entity.

**Enabling Global Search** requires the `GlobalSearchUrl` (+ `GlobalSearchConfigServiceUrl`,
`GlobalSearchIndexingApiUrl`) system settings and the `GlobalSearch` / `GlobalSearch_V2` feature
toggles, with the section index built (Elasticsearch reachable).

---

## Docker

The image supports both transports, selected by `CREATIO_MCP_TRANSPORT` (default `http`).

**HTTP** (remote / hosted / multi-client — defaults to delegated Bearer auth):

```bash
docker run --rm -p 3000:3000 \
  -e CREATIO_BASE_URL="https://your-creatio.com" \
  -e CREATIO_MCP_AUTH_MODE=delegated \
  crackish/mcp-creatio
```

**stdio** (local client that spawns the process — note `-i`; use client-credentials or legacy auth):

```bash
docker run -i --rm \
  -e CREATIO_MCP_TRANSPORT=stdio \
  -e CREATIO_BASE_URL="https://your-creatio.com" \
  -e CREATIO_LOGIN="YourLogin" -e CREATIO_PASSWORD="YourPassword" \
  crackish/mcp-creatio
```
