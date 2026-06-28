# Agent Guide: MCP Creatio Server

This document is for AI coding agents contributing to this repository. It explains project purpose, architecture, invariants, and safe extension patterns.

## 1. Purpose

An implementation of a Model Context Protocol (MCP) server that exposes Creatio CRM to MCP-compatible AI clients (Claude Desktop, ChatGPT Connectors, GitHub Copilot, etc.).

Primary goals:

- Provide stable tool surface for CRUD, schema discovery, business process execution.
- Enforce safe data operations (especially Activities ownership rules, date/time UTC handling).
- Offer prompts that guide LLMs to use Creatio correctly.

## 2. High-Level Architecture

```
src/
  creatio/            ← Low-level Creatio API client & auth providers
    contracts/        ← provider interfaces (CrudProvider, ProcessProvider, … — the "ports")
    services/         ← provider impls; CRUD backends in odata/ + dataservice/, plus process, sys-settings, …
    engines/          ← domain layer over the contracts (readonly guard + audit; see below)
    auth/             ← auth providers (legacy / OAuth2 client-credentials / stateless Bearer / broker) + core contract (contracts/headers/identity/constants)
  server/             ← MCP server + HTTP layer (bearer edge, broker OAuth server, handlers)
    mcp/              ← MCP tool descriptors, prompts, filters builder
      tool-preparer.ts  ← ToolPreparer/ToolRegistrar contracts (env-gated tools)
      creatio-rest.ts   ← shared REST/sys-setting contracts + helpers for capability clients
      dataforge/        ← DataForge capability: client + tool preparer
      globalsearch/     ← Global Search capability: client + tool preparer
    bearer/           ← stateless per-request Bearer edge (delegated: RFC 9728 + fail-fast expiry; gateway: trust)
    oauth/            ← broker mode: the MCP's own OAuth 2.1 AS (DCR + /authorize + /token, JWT + PKCE)
  sessions/           ← per-process MCP session/transport lifecycle + per-user Creatio token store (broker only)
  utils/              ← Reusable helpers (env, network, context)
  types/              ← Shared TypeScript interfaces & DTO shapes
```

> Naming: `creatio/contracts/` holds the interfaces ("ports"), `creatio/services/` the
> implementations. The per-process session store lives in top-level `sessions/` (distinct
> from `creatio/services/`).

### Run modes & deployment

Two entry points, one `Server` core:

- **HTTP web service** — `src/index.ts` (`npm start`) → `HttpServer` on `CREATIO_MCP_PORT` (default
  3000), MCP over Streamable HTTP at `/mcp`. The multi-user transport, serving three HTTP auth
  modes: **`broker`** (the MCP is its own OAuth 2.1 AS and holds users' Creatio tokens),
  **`delegated`** (default — client brings the token), and **`gateway`** (a Control-Plane injects
  it). Config from env (`getCreatioClientConfig`); HTTP defaults to `delegated` when no auth is set.
- **stdio** — `src/cli.ts` (the npm `bin` `mcp-creatio`; `npm run start:stdio`) → `StdioServerTransport`.
  For a local client (Claude Desktop) that spawns the process. CLI args map onto the same env vars.

> **One `McpServer` per session (multi-user invariant).** `Server.createSessionServer()` builds a
> fresh `McpServer` bound to each transport — a single `McpServer` connects to only one transport,
> so a shared instance would reject the 2nd concurrent session's `connect()`. The tool/descriptor
> maps are user-agnostic (identity is read from the per-request `AsyncLocalStorage` context at call
> time) and shared across sessions. `stopAll()` closes them on shutdown.

The **Docker** image (multi-stage, `node:24-alpine`, runs the built `dist/` — not `ts-node`)
serves **HTTP by default**; set `MCP_TRANSPORT=stdio` (run with `docker run -i`) to switch. The
`docker-entrypoint.sh` selects `dist/index.js` vs `dist/cli.js`. Both transports read the same
env. The `.github/workflows/docker-publish.yml` builds multi-arch on `main`/`v*` tags and syncs
the README to the Docker Hub overview.

Key flows:

1. Client authenticates (HTTP: `broker` — MCP-issued token, or per-request Bearer — delegated/gateway; stdio: client-credentials or legacy).
2. MCP server registers tools using descriptors from `server/mcp/tools-data.ts`.
3. Tool handlers call into `CreatioEngineManager`, which resolves a `CreatioServiceContext` (built from `src/creatio/services/*`) and delegates work to the appropriate provider (CRUD, process, sys-settings, user).
4. Responses are normalized into MCP content blocks.

### Creatio Service Stack (LLM Cheat Sheet)

```
CreatioServiceContext
  ├─ CreatioAuthManager → selects the provider for CREATIO_MCP_AUTH_MODE (legacy / client-credentials / stateless Bearer / broker)
  ├─ CreatioHttpClient → transport + logging + retry + header helpers
  │     └─ request(op, url, build, onSuccess, {errorPrefix, logContext}) → the standard
  │        timed call (wraps executeWithTiming + handleErrorResponse); prefer it in providers
  ├─ createCrudProvider(config.crudBackend, …) → selects the CRUD backend per-deployment
  │     ├─ DataServiceCrudProvider (DEFAULT) → SelectQuery/Insert/Update/Delete via
  │     │     /0/DataService/json/SyncReply/*; schema via RuntimeEntitySchemaRequest +
  │     │     VwSysSchemaInWorkspace (services/dataservice/*)
  │     └─ ODataCrudProvider (CREATIO_MCP_CRUD_BACKEND=odata) → http + ODataMetadataStore
  │           (services/odata/*)
  ├─ ProcessServiceProvider → POSTs to ProcessEngineService
  ├─ SysSettingsServiceProvider → DataService JSON endpoint
  ├─ FeatureServiceProvider → /rest/FeatureService/ClearFeaturesCacheForAllUsers
  ├─ AdminOperationServiceProvider → /rest/RightsService/{Upsert,Delete}AdminOperation[,Grantee]
  ├─ ConfigurationServiceProvider → generic /rest/<service>/<method> caller
  └─ UserInfoProvider → UserInfoService for current user data
```

Usage pattern:

- Handlers never craft raw fetch calls. They work through provider interfaces exposed by the context (`provider.crud`, `provider.process`, etc.).
- If you need a new Creatio capability, add a dedicated provider (or extend an existing one) and wire it up inside `CreatioServiceContext`.
- `CreatioHttpClient` should stay transport-focused (auth headers, retries, timing). Keep endpoint-specific logic inside providers or a dedicated endpoint helper. Use `client.request(...)` for the standard timed call instead of repeating the `executeWithTiming` + `handleErrorResponse` boilerplate.

### Engine layer (domain cross-cutting — NOT a pass-through)

The engines under `src/creatio/engines/` are the domain seam ABOVE the provider interface, so cross-cutting policy is written once for every CRUD backend. `BaseEngine._mutate(action, details, run)` enforces `readonly` (throws `ReadonlyModeError`) and records an audit entry (`log.audit`) before delegating. **Every new mutating engine method MUST route through `_mutate`; read methods stay direct pass-throughs.** `CreatioEngineManager` owns the shared `EngineEnv` ({readonly, audit}); readonly is threaded from `CREATIO_MCP_READONLY`.

### CRUD backend selection + neutral query contract

`createCrudProvider(backend, deps)` (`src/creatio/services/crud-provider-factory.ts`) picks the backend per-deployment from `CREATIO_MCP_CRUD_BACKEND` (**`dataservice` default** | `odata`), mirroring `CreatioAuthManager`. Both backends are fully implemented; each lives in its own folder (`services/dataservice/*`, `services/odata/*`). To add a backend: implement `CrudProvider`, add a branch in the factory — nothing above the interface changes.

The seam is a **backend-agnostic query contract** (`src/creatio/contracts/query.ts`): `ReadQuery` carries a structured `FilterNode` AST (NOT a dialect string), neutral `columns`/`order`/paging, and an `odata` bag for OData-only escape hatches (`rawFilter`, `expand`). `read` returns a normalized `ReadResult { items, totalCount? }`. Each backend owns a **translator** (Information Expert): `ODataQueryTranslator` (AST → `$filter`/`$select`/`$orderby`, incl. the lookup-nav `XxxId→Xxx/Id` + bare-GUID quirks) and `DataServiceFilterTranslator`/`DataServiceQueryBuilder` (AST → `Filters` tree + `Columns`, paths normalized `Contact/Id → Contact.Id`). DataService writes type `ColumnValues` from `RuntimeEntitySchemaRequest` metadata (authoritative `dataValueType`) with a heuristic fallback — the platform never infers the type from the JSON value. `mcp/filters.ts` only compiles the tool's `{all,any}` arg into a `FilterNode` (`buildFilterNode`) + parses `orderBy`; it knows nothing about either dialect.

#### DataService wire-value gotchas (verified live vs real Creatio — do NOT regress)

These are exact platform contracts confirmed against `core` / the devkit ESQ. Each was a real
bug found in live regression; the values are load-bearing, not stylistic:

- **`FilterComparisonType`** numbers (core `EntitySchemaQueryFilter.cs`): `IsNull=1, IsNotNull=2,
Equal=3, NotEqual=4, Less=5, LessOrEqual=6, Greater=7, GreaterOrEqual=8, StartWith=9,
Contain=11, EndWith=13`. (Getting these wrong silently inverts gt/ge/lt/le.)
- **`IsNullFilter` needs an explicit `isNull` boolean** (`true` for is-null, `false` for
  is-not-null). The platform `Filter.IsNull` defaults to TRUE, so omitting it makes every
  null-check an IS NULL (inverts `isNotNull`).
- **DateTime parameter value** = JSON-quoted local-ISO WITHOUT `Z`/offset (`"2026-06-01T00:00:00"`,
  mirrors devkit `ɵencodeDate`); the server interprets it in the user-profile timezone. A raw
  `…Z` string 500s. (OData is the opposite: bare `Edm.DateTimeOffset` WITH `Z`.)
- **Write coercion**: `RuntimeEntitySchemaRequest` returns EXTENDED column `dataValueType`
  codes (e.g. MediumText=28); a Parameter must use the BASE type — map via
  `toParameterDataValueType` (extended→base), else 500 "NotSupportedException".
- **Lookup columns**: a scalar FK `XxxId` is not a DataService column. For filters/select,
  `lookupIdPath` normalizes `XxxId → Xxx.Id` (and `/`→`.`); for writes, the FK key remaps to the
  logical lookup column (`Type`). A bare lookup (`Type`) returns its display value.
- **`top:0`** → DataService rejects `FETCH 0`; the builder omits paging and the provider returns
  `[]` without the row query (still runs the COUNT query). `count` uses a separate aggregation
  SelectQuery; `list-entities` is `VwSysSchemaInWorkspace` deduped by Name; reads project to the
  requested columns (DataService auto-adds primary `Photo`/display columns).

## 3. Core Modules You Will Touch

| Area                         | File(s)                                                                 | Notes                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool registration            | `src/server/mcp/server.ts`                                              | Add/remove tool handlers; keep descriptors in separate file. Composition root that also runs tool preparers.                                                                                                                                                                                           |
| Tool schemas & text guidance | `src/server/mcp/tools-data.ts`                                          | Use `zod` schemas; detailed descriptions help AI reasoning.                                                                                                                                                                                                                                            |
| Env-gated capabilities       | `src/server/mcp/tool-preparer.ts`, `src/server/mcp/dataforge/*`         | `ToolPreparer` strategy: probe once (in the first request's context), register tools only when the capability is available. DataForge is the reference impl.                                                                                                                                           |
| Query contract               | `src/creatio/contracts/query.ts`                                        | Neutral `ReadQuery`/`FilterNode`/`ReadResult`; the seam both CRUD backends translate from.                                                                                                                                                                                                             |
| Filters logic                | `src/server/mcp/filters.ts`                                             | `buildFilterNode` compiles the tool `{all,any}` arg into the neutral `FilterNode` AST (+ `parseOrderBy`). NO dialect here.                                                                                                                                                                             |
| Backend translators          | `src/creatio/services/{odata,dataservice}/*`                            | `ODataQueryTranslator` / `DataServiceFilterTranslator`+builder turn `FilterNode` into each dialect.                                                                                                                                                                                                    |
| Prompts                      | `src/server/mcp/prompts-data.ts`                                        | Pre-baked instructional prompts consumed by clients.                                                                                                                                                                                                                                                   |
| Creatio API                  | `src/creatio/services/*`                                                | `CreatioServiceContext` composes auth + http client + providers; extend providers instead of bypassing them.                                                                                                                                                                                           |
| Client auth (HTTP)           | `src/server/bearer/*`, `src/server/oauth/*` + `http/broker-handlers.ts` | `bearer/` = stateless edge (delegated: RFC 9728 metadata; gateway: trust injected token). `oauth/` + broker-handlers = the `broker` mode: MCP is its own OAuth 2.1 AS (DCR + /authorize + /token) brokering authorization_code+PKCE to Creatio and holding user tokens server-side (`SessionContext`). |

## 4. Invariants & Rules (Do NOT Break)

1. All date/time fields passed to Creatio MUST be UTC ISO8601 with `Z` suffix.
2. Activity creation: Always set `OwnerId` and `AuthorId` to current user's ContactId obtained via `get-current-user-info` unless user explicitly specifies another owner.
3. Avoid adding blocking network calls in tool descriptors—descriptors must be static; logic belongs in handlers.
4. Never silently swallow errors coming from Creatio—log via `log.error` then rethrow.
5. Keep tool names stable: lowercase kebab-case (e.g. `execute-process`).
6. Auth selection: an explicit `CREATIO_MCP_AUTH_MODE` always wins; when unset the mode is INFERRED in order legacy (login+password) → client_credentials (id+secret) → delegated. `broker`/`delegated`/`gateway` are HTTP-only. Token handling differs by mode: **`broker`** issues its own client tokens AND stores users' Creatio tokens server-side (`SessionContext`); `delegated`/`gateway` pass the client/gateway token straight through and store nothing; `client_credentials`/`legacy` hold one server-side identity.
7. Do not leak secrets or access tokens in tool responses.
8. `CREATIO_MCP_READONLY=true` must guarantee no mutation tools (`create`, `update`, `delete`, `execute-process`, `set-sys-settings-value`, `create-sys-setting`, `update-sys-setting-definition`, `refresh-feature-cache`, `upsert-admin-operation`, `delete-admin-operation`, `set-admin-operation-grantee`, `delete-admin-operation-grantee`, `call-configuration-service`) are registered. This is enforced at two layers: the MCP layer does not register these tools, AND the engine layer's `_mutate` throws `ReadonlyModeError` (defense-in-depth) — both read `CREATIO_MCP_READONLY`.

## 5. Adding a New Tool (Checklist)

1. Define input shape in `tools-data.ts` using `zod`.
2. Provide rich description (include examples, edge cases, warnings).
3. Export descriptor & input schema.
4. Add a row to the declarative tool table in `server.ts` (`_clientToolDefs()` → `core` for reads, `mutating` for writes — only `mutating` tools are gated out in readonly mode). Each row is `{ name, descriptor, input, run }`.
5. Implement `run` by calling the appropriate engine on the `CreatioEngineManager` (`crud`, `process`, …); if functionality is missing, extend or add a provider under `src/creatio/services` (+ its `contracts/` interface) rather than issuing raw fetch calls. New mutating engine methods must route through `BaseEngine._mutate`.
6. Return **raw domain data** from `run` — the single `_normalizeToToolHandler` wraps it into `{ content: [{ type: 'text', text }] }` (objects/arrays are `JSON.stringify`-ed, strings passed through, a genuine `{ content: [...] }` envelope passed through as-is). Do not hand-wrap.
7. Add edge-case validation (empty arrays, invalid GUID, missing required filter fields).
8. **Write tests** (see §10): a `server.test.ts` case asserting the handler delegates + readonly gating, plus provider-level tests via `makeHttpClientHarness` for any new `src/creatio/services` code. Run `npm run test:coverage` and stay ≥90%.
9. Update documentation (README if public feature; otherwise just AGENTS.md).

### 5.1 Environment-gated tools (Tool Preparers)

Some capabilities only exist on certain Creatio environments (e.g. **DataForge** — the AI semantic layer over the data model — is present only when `DataForgeServiceUrl` is configured). Such tools must NOT be registered unconditionally. Use the `ToolPreparer` pattern instead of inlining probes into `server.ts`.

Contracts live in `src/server/mcp/tool-preparer.ts`:

- `ToolPreparer` — `{ name; prepare(registrar): Promise<boolean> }`. Probes the environment and, only when available, registers its tools. Returns whether the capability is enabled.
- `ToolRegistrar` — thin sink (`register(name, descriptor, handler)`) that decouples preparers from `Server` internals.

How it wires up:

1. `Server` builds the capability's client + preparer in its constructor and pushes the preparer into `_preparers` — UNLESS the capability is force-disabled via `ServerConfig` (`disableDataForge` / `disableGlobalSearch`, fed from env `CREATIO_MCP_DISABLE_DATAFORGE` / `CREATIO_MCP_DISABLE_GLOBAL_SEARCH`). A disabled capability is never added to `_preparers`, so it is neither probed (no network / no token spend) nor registered — even on an environment where it IS available. `_isDataForgeReady()` then stays false, so `describe-entity` falls back to the active CRUD backend.
2. `ensureCapabilitiesProbed()` runs `_prepareTools()` once, lazily, from INSIDE the first request's `runWithContext` — so the probe's Creatio calls carry the caller's identity (broker mode has no user otherwise). It is **non-blocking** (fire-and-forget, so the MCP handshake isn't delayed) and **self-healing**: a preparer that returns cleanly records its verdict in `_capabilities` and is never re-probed; one that THROWS (e.g. identity not usable yet) records nothing, so a later authenticated connect retries it. Newly-registered tools are pushed into every live session server (the SDK emits `tools/list_changed`).
3. Core tools can branch on a capability via `_capabilities` (e.g. `describe-entity` routes through DataForge when ready, otherwise falls back to OData — see below).

Capability clients share the narrow REST/sys-setting contracts and the
`hasNonEmptySetting`/`getSettingValue` helpers in `src/server/mcp/creatio-rest.ts`
(QuerySysSettings returns each setting as `{ code, value, … }` — always unwrap `.value`).

Three capabilities follow this pattern today:

- **DataForge** (`dataforge/`, 5 tools + describe-entity routing) — gated on `DataForgeServiceUrl`.
- **Global Search** (`globalsearch/`, one `global-search` tool) — gated on `GlobalSearchUrl`.
- **Published tools** (`crtmcp/`) — a hidden, opt-in proxy for the `CrtMCPPublishingApp`
  composable app. Gated on the `CREATIO_MCP_ENABLE_PUBLISHED_TOOLS` env flag (default off) AND the app
  being installed. Enumerates online `McpServer`s, calls each server's JSON-RPC
  `/0/rest/ToolServiceMcp/{code}/v1/mcp` `tools/list`, and re-exposes each published tool
  under a `pub-<server>-<tool>` name that proxies `tools/call` back to the app (the app keeps
  ownership of schema/RBAC/validation/execution). JSON Schema → Zod via `json-schema-to-zod.ts`;
  multi-segment route reached via `ConfigurationCaller.rawPath`. Intentionally undocumented in
  the README.

Add the next capability the same way.

Reference implementation (`src/server/mcp/dataforge/`):

- `DataForgeClient` — single responsibility: talk to the Creatio-hosted DataForge REST services (`DataForgeSchemaReadService`, `DataForgeMaintenanceService`). Wraps single-parameter DTOs under `request` (WCF `BodyStyle = Wrapped`), depends on narrow `ConfigurationCaller`/`SysSettingReader` interfaces (DIP), and exposes `isEnabled()` (probe via `DataForgeServiceUrl`) plus `getColumnsOrNull()` for graceful per-call fallback.
- `DataForgeToolPreparer` — registers `dataforge-similar-tables`, `-table-details`, `-table-relationships`, `-lookup-values`, `-status` only when `isEnabled()` is true.

Rules for new gated capabilities:

- Add a client (talks to Creatio, no MCP knowledge) + a `ToolPreparer` (registers tools). Do not put endpoint logic in `server.ts`.
- Probe must be cheap and degrade to "disabled" on any error (never throw out of `prepare`).
- Read-only gated tools are registered regardless of `CREATIO_MCP_READONLY` (they do not mutate); keep mutating gated tools behind the readonly check.
- `describe-entity` enrichment: when DataForge is enabled it returns `{ source: 'dataforge', entitySet, dataForge }`, otherwise `{ source: 'odata', entitySet, metadata }`. Preserve this `source` discriminator if you touch it.

## 6. Error Handling Pattern

- Use `try/catch` in handlers ONLY if you need to wrap/transform the error.
- Log with contextual tag: `log.error('mcp.tool.handler', err)`.
- Throw the original error afterward (MCP layer will relay).
- For validation failures rely on `withValidation(...)` wrapper.

## 7. Logging Guidelines

- Use `log.info('mcp.tool.register', { tool })` when registering tools.
- Use `log.warn` for non-fatal recoverable issues (e.g., partial data fetch).
- Use `log.error` strictly for failures that abort the operation.

## 8. Performance Considerations

- Prefer `select` + `expand` to limit payload size; educate users via descriptor text.
- Batch calls carefully—avoid sequential redundant reads if data already provided.
- Avoid adding expensive synchronous CPU logic inside handlers.

## 9. Security & Safety

- Never echo passwords or client secrets back to clients.
- Strip or mask token-like values if accidentally included in objects.
- Validate GUID format (8-4-4-4-12 hex) when exposing user input into queries.

## 10. Testing (MANDATORY)

There is a real test suite (Vitest + supertest) and **every code change must ship with tests**. This is not optional.

### Rules

1. **No PR without tests.** Any new tool, provider, handler, util, or bug fix must add or update tests in the same change.
2. **Coverage gate: ≥90%** statements/functions/lines. Run `npm run test:coverage` and do not regress below 90%.
3. **Fixing a bug = writing a regression test first** that fails on the old behavior, then making it pass. For security/perf fixes, label the test with the finding (e.g. `// C1`, `// H2`) so the intent survives.
4. `npm test` and `npm run build` must both be green before committing.

### Commands

- `npm test` — run the whole suite once.
- `npm run test:watch` — watch mode while developing.
- `npm run test:coverage` — coverage report (v8).

### Layout

```
test/
  unit/        ← pure logic + classes with fakes (most tests live here)
  api/         ← supertest against the real Express app (HTTP/MCP routes)
  support/     ← shared test harness (USE THESE, do not reinvent)
    http-client.ts   → makeHttpClientHarness(responder), jsonResponse, textResponse, bodyOf
    fake-context.ts  → makeFakeContext(authType) — a full CreatioProviderContext of vi.fn() stubs
    test-server.ts   → createTestServer(), createAuthProviderMock(), resetSessionContext()
```

Tests live **outside `src/`** so the `tsc` build stays clean. Name files `*.test.ts`. Keep the logger quiet (the vitest config already sets `CREATIO_MCP_LOG_LEVEL=silent`).

### Which level to use (pick the closest to what you changed)

| You changed…                                                       | Test it like this                                                                                                                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pure function (filters, validators, pkce, env, key formatting)   | Plain unit test, no mocks.                                                                                                                                                                                     |
| A **service provider** (`src/creatio/services/*`)                  | `makeHttpClientHarness(responder)` gives a real `CreatioHttpClient` + stubbed `fetch`. Assert the request URL/method/body (`bodyOf(calls[0])`) and the parsed result. Cover the non-2xx error path too.        |
| A **tool handler / registration** (`server.ts`)                    | `new Server(new CreatioEngineManager(makeFakeContext()), {...})`, then invoke `(server as any)._handlers.get('tool-name')(payload)` and assert the provider stub was called. Also assert readonly-mode gating. |
| An **HTTP / OAuth / MCP endpoint**                                 | `createTestServer()` → `supertest(app)`. Call `resetSessionContext()` in `beforeEach`. Assert status codes, redirects, and that secrets/identity are handled correctly.                                        |
| An **auth provider**                                               | `vi.stubGlobal('fetch', vi.fn(...))` for the token endpoint, wrap calls in `runWithContext({ userKey })`, seed/read `SessionContext.instance`.                                                                 |
| **Time- or concurrency-sensitive** code (TTL, refresh, schedulers) | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)`; for dedup, fire N concurrent calls with `Promise.all` and assert the underlying op ran once.                                                        |

### Conventions

- Reset shared singletons (`SessionContext.instance`) with `resetSessionContext()` between tests; build fresh `RateLimiter`/`HttpServer`/providers per test.
- Prefer driving real code through the harness over asserting on mocks-of-mocks. Service-provider tests use a **real** `CreatioHttpClient`; only `fetch` is stubbed.
- Cover the unhappy paths explicitly (4xx/5xx, parse failure, expired, missing token/identity) — that is where the bugs are.
- Process entry points (`cli.ts`, `index.ts`) are excluded from coverage; unit-test their pure helpers instead.

### Verifying the auth modes live (manual, against a real Creatio)

The unit suite covers the auth logic; this is the recipe for a live end-to-end smoke test of each
`CREATIO_MCP_AUTH_MODE` against a real instance. Common to all: build first (`npm run build`), then
`node dist/index.js` with the env below. The dev stand's TLS cert key is weak, so the Node process
needs `NODE_TLS_REJECT_UNAUTHORIZED=0` (and even then Node's `fetch` rejects it with
`EE certificate key too weak` — fetch a token with `curl -k` instead, see delegated/gateway).

**`broker` — drive with a real OAuth MCP client** (e.g. Claude Code), because the OAuth + browser
consent flow is the point of the mode:

```bash
CREATIO_MCP_AUTH_MODE=broker CREATIO_BASE_URL=… CREATIO_CLIENT_ID=… \
CREATIO_CLIENT_SECRET=…           # only for a confidential Creatio app
CREATIO_MCP_JWT_SECRET=…          # ≥32 chars; required in prod; set it so client tokens survive a restart
NODE_TLS_REJECT_UNAUTHORIZED=0 node dist/index.js
```

Point the client at `http://localhost:3000/mcp`; it discovers the AS (RFC 9728/8414), registers
(DCR), and opens the browser for Creatio login. Verify in logs: `/oauth/callback → 302` (no
`broker.creatio.exchange_failed`) → `session.connect` → `mcp.prepare … enabled:true`. The same Creatio
app works public (PKCE only), confidential (`+ client_secret`), and with "Enforce PKCE" on/off — the
broker always sends S256 PKCE. After a restart the in-memory Creatio tokens are gone, so the client's
still-valid JWT gets `401 invalid_token` → it must re-authorize (in Claude Code: **Clear
authentication** → reconnect).

**`client_credentials` / `legacy` / `delegated` / `gateway` — drive with a direct handshake.** These
have no per-user OAuth, so a plain MCP client can't trigger a login; test them with a raw
Streamable-HTTP handshake instead: `POST /mcp` `initialize` → `notifications/initialized` →
`tools/call get-current-user-info` (carry the `mcp-session-id` header the initialize response
returns). Expect the call to resolve to the expected user.

- `client_credentials`: env `CREATIO_MCP_AUTH_MODE=client_credentials` + `CREATIO_CLIENT_ID`/`SECRET`;
  `/mcp` is open (no edge), the provider injects the M2M token. Confirm `creatio.auth.ok authKind=oauth2`.
- `legacy`: env `…=legacy` + `CREATIO_LOGIN`/`CREATIO_PASSWORD`. Confirm `creatio.auth.ok authKind=legacy`.
- `delegated`/`gateway`: the request must carry `Authorization: Bearer <a real Creatio token>`. Mint
  one out-of-band (e.g. `curl -k` the client_credentials grant at `<base>/0/connect/token`) and pass
  it through. A request with **no** token must get `401`; `gateway` also honors `X-Creatio-Base-Url`.

## 11. Versioning & Release (MANDATORY checklist)

`src/version.ts` reads the version dynamically from `package.json`. Use semantic commit
prefixes (`feat:`, `fix:`, `docs:`, `chore:`). **Whenever you bump the version, you MUST do
the full release — never bump without tagging AND publishing:**

1. `npm version <x.y.z> --no-git-tag-version` (updates `package.json` + lockfile, no auto-tag).
2. Update `CHANGELOG.md` (new version section; what changed, grouped Added/Fixed/Changed).
3. `npm run build` + `npm test` — must be green (the build also runs on `prepack`).
4. Commit: `chore(release): vX.Y.Z`.
5. **Tag**: `git tag vX.Y.Z` (use the `v` prefix).
6. **Push** commit + tag: `git push origin main && git push origin vX.Y.Z`.
7. **Publish to npm**: `npm publish` (public; `prepack` rebuilds `dist`; verify `npm view mcp-creatio version`).

Skipping the tag or the npm publish leaves the release half-done — always finish all 7 steps.

**Automated on the tag push** (no manual step): `.github/workflows/release.yml` extracts the
CHANGELOG section and creates the **GitHub Release**; `docker-publish.yml` builds the multi-arch
image (`:latest` + `:vX.Y.Z`) and syncs the README to the Docker Hub overview. (Note: `gh` in
this dev env is authed to the GHE host, not github.com — creating github.com releases must go
through CI, not local `gh`. Backfill an old tag via the workflow's `workflow_dispatch`.)

## 12. Common Edge Cases

| Case                                      | Mitigation                                                     |
| ----------------------------------------- | -------------------------------------------------------------- |
| Empty `select` array supplied             | Preprocess to `undefined` (already handled)                    |
| Mixed raw `filter` + structured `filters` | Combine with `and` parenthesized in handler                    |
| Invalid GUID quoting                      | Provide guidance text + possible pre-validation before sending |
| Large result sets                         | Encourage `top` param (<200 recommended)                       |
| Readonly mode attempt to mutate           | Ensure mutation tools not registered                           |

## 13. Extending Authentication

If adding new auth provider:

1. Create provider under `src/creatio/auth/providers/` (extend `BaseProvider`, which requires only the single `ICreatioAuthProvider` contract: `getHeaders` + `refresh` + `cancelAllRefresh`). The current providers are `LegacyProvider`, `OAuth2Provider` (client credentials), `OAuth2BearerProvider` (stateless per-request passthrough — delegated/gateway), and `BrokerProvider` (serves the user's broker-held Creatio tokens, refreshing on demand).
2. Add selection logic in `auth-manager.ts` and `config-builder.ts`, preserving the order: explicit `CREATIO_MCP_AUTH_MODE` wins, else inferred legacy → client_credentials → delegated.
3. Document environment variables clearly in README + AGENTS.md.

> **Token model by mode.** In **`broker`** the MCP IS its own OAuth 2.1 authorization server for
> clients (`src/server/oauth/` + `http/broker-handlers.ts`): it does DCR + `/authorize` + `/token`
> (`authorization_code` **and** rotating `refresh_token` grants), brokers the login to Creatio via
> authorization_code+PKCE, and holds each user's Creatio tokens server-side via a `TokenStore`
> (`src/sessions/token-store.ts`). The tokens it issues are **audience-bound** (`aud`=`/mcp`,
> `iss`=origin; verified on every `/mcp` call) so a token from one deployment is rejected by another
> sharing the secret; the signing secret (`CREATIO_MCP_JWT_SECRET`) must be ≥32 chars and is required
> in production.
>
> **Broker token store + prod.** Default `InMemoryTokenStore` (lost on restart — a `401 invalid_token`
> then makes the client re-authorize; single instance only). For production set
> `CREATIO_MCP_TOKEN_STORE=redis` + `CREATIO_MCP_REDIS_URL`: `RedisTokenStore` (lazy `redis` dep)
> encrypts tokens at rest (AES-256-GCM, `token-crypto.ts`; key from `CREATIO_MCP_TOKEN_ENC_KEY` else
> derived from the JWT secret) with native per-key TTL → stateless, restart-durable, multi-instance.
> Behind a TLS-terminating proxy set `CREATIO_MCP_PUBLIC_URL` so `iss`/`aud`/redirects/discovery use
> the external origin (`resolvePublicOrigin`), not the internal hop. Logout = **RFC 7009** `POST
> /revoke` (`revocation_endpoint`): revokes the Creatio token upstream (`/connect/revocation`,
> best-effort) + purges the server-side + issued-refresh tokens; always answers 200.
>
> In **`delegated`/`gateway`** the MCP stores nothing and does **not** cryptographically verify the
> Bearer — both are **fully-trusted-environment** modes (Creatio is the authority; the request's
> `userKey` is an unverified, logging-only identity). The client (delegated, token obtained from
> Creatio Identity, advertised via RFC 9728) or a fronting Control-Plane (gateway) supplies the token
> and the Bearer edge in `src/server/bearer/` passes it through. Gateway's `X-Creatio-Base-Url`
> override is validated against `CREATIO_MCP_ALLOWED_BASE_URLS` (and always blocks cloud-metadata IPs)
> since it controls where the Bearer is sent. For an untrusted direct external client, use `broker`.

> **Session keep-alive (single-session modes only).** `legacy`/`client_credentials` hold one shared
> Creatio session; a long idle period lets Creatio drop the forms cookie. Reactive reconnect (the
> HTTP client retries on `401` AND on a login-page→HTML bounce) keeps it correct; `SessionKeepAlive`
> (`src/server/keepalive.ts`) additionally pings `get-current-user-info` on an interval to avoid the
> first-call re-login latency. `CREATIO_MCP_KEEPALIVE_SECONDS` controls it — **default 300s (5 min)**,
> `0` disables. NOT used for broker/delegated/gateway (per-user / per-request, no shared session).

## 14. Prompts Extension

- Add new prompt object in `prompts-data.ts` (`name`, `title`, `description`, `argsSchema`, `callback`).
- Keep names unique and descriptive.
- Avoid external network calls inside prompt callbacks.

## 15. Code Style & Engineering Principles

Write every change to the **highest engineering bar** — this codebase is held to SOLID, GRASP,
Clean Code and proven design patterns, not "make it work". Before adding code, prefer the
design that an experienced reviewer would: clear responsibilities, small seams, no leaks.

**Principles (apply, don't just cite):**

- **SOLID** — SRP (one reason to change per class: see the provider/translator/engine split);
  OCP (extend via a new Strategy + factory branch, e.g. CRUD backends, not `if/else` edits);
  LSP (every `CrudProvider`/auth provider is fully substitutable — no throwing stubs); ISP
  (keep contracts minimal, e.g. the single-capability `ICreatioAuthProvider`, `CrudCapabilities`);
  DIP (handlers depend on contract interfaces, never concrete transports).
- **GRASP** — Information Expert (the dialect lives in its translator; the backend owns its
  capabilities), Pure Fabrication (translators/transport/query-builder), Low Coupling / High
  Cohesion, Protected Variations (the neutral `ReadQuery`/`FilterNode` seam shields callers
  from backend differences).
- **Clean Code** — intention-revealing names, small single-responsibility functions, no
  duplication (extract shared helpers like `assertEntityName`/`lookupIdPath`), comments explain
  _why_ (platform quirks, wire-value provenance), guard clauses over deep nesting.
- **Patterns** — Strategy (CRUD backends, auth, tool preparers), Factory (`createCrudProvider`),
  Adapter (translators OData/DataService), Template Method (`BaseEngine._mutate`), Facade
  (`CreatioServiceContext`). Reach for the pattern that removes the smell — don't over-engineer.

**Baseline rules** (full list in `docs/coding-style.md`):

- Keep TypeScript strict (avoid `any`, prefer explicit interfaces).
- Class-member ordering: readonly fields → fields → getters → setters → constructor → methods, each `private → protected → public`.
- Prefix private fields/methods with `_`; reuse utility wrappers (`withValidation`, `client.request`); reuse established logging tags.
- Keep functions small and single-responsibility; isolate dialect/transport specifics behind a seam.

**Tests are part of "done" (see §10): every code change ships with tests in the same change** —
unit for pure logic (translators, value-type, filters) and full-stack/API for wiring
(Server→engine→provider). New behavior or a fixed bug without a covering test is incomplete.

## 16. What NOT To Do

- Do not reintroduce removed tools (`search`, `fetch`) unless strong justification & design review.
- Do not bypass `CreatioServiceContext`/providers with raw fetch calls scattered in handlers.
- Do not embed long multi-megabyte payloads in commit history (limit sample data).

## 17. Quick Start for Agent Changes

1. Make code edits **and their tests together** (§10).
2. Run `npm test` — the suite must be green.
3. Run `npm run build` to ensure TypeScript passes.
4. Run `npm run test:coverage` and confirm ≥90% (no regression).
5. Optionally lint: `npm run lint`.
6. Commit using a conventional message.
7. Push; consider tag if version bump.

## 18. Future Enhancements (Suggestions)

- Implement persistent token storage (e.g., file/Redis) for broker-held Creatio tokens (today in-memory in `SessionContext`, lost on restart).
- Provide structured error codes instead of raw messages.
- Raise branch coverage toward 90% and wire `npm test` into CI.
- Live-regress the DataService backend against a real environment, then consider dropping the
  raw OData `$filter`/`expand` escape hatches entirely (structured `filters` is portable).
- Split `CrudProvider` per ISP into `ICrudProvider` + `ISchemaProvider` (schema discovery is
  backend-independent); today the DataService schema lives in `DataServiceSchemaProvider`.

## 19. Contact Points

If you need business logic clarification, check existing descriptor guidance first. Many patterns (date handling, ownership) are documented inline in `tools-data.ts`.

---

**Summary:** Focus on safe MCP tool extension around Creatio CRM. Preserve invariants, keep descriptors rich, centralize API interactions, and avoid leaking credentials.
