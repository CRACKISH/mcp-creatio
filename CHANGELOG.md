# Changelog

All notable changes to **mcp-creatio** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.4]

Output-edge secret redaction + a content-validated schema cache that auto-invalidates when the
Creatio data model changes (and is multi-tenant-safe). Schema-freshness live-verified vs a real
Creatio; 570 tests, 94.6% line coverage.

### Security

- **Central secret redaction** — a single `redactSecrets` layer scrubs credential-looking values
  (`Bearer`/`Basic`/`Authorization`, and `client_secret`/`password`/`access_token`/`refresh_token`/
  `BPMCSRF`-style params) from **both** tool results relayed to the client **and** log lines. This
  turns the long-standing "never leak secrets/tokens" invariant from a convention into an enforced
  choke point. Errors thrown from tool handlers are scrubbed too, while preserving the `Error`
  type/stack (no silent swallowing).

### Added

- **Content-validated schema cache** — schema/metadata caches (`describe-entity`, `list-entities`,
  DataService write-coercion, OData `$metadata`) now validate against Creatio's own client-cache
  hash stamp (`GET /api/ClientCache/Hashes` — the `runtime-entity-schema` bucket + `cacheVersion`,
  the same signal the Freedom UI uses). When the data model changes at runtime (add/alter/remove an
  entity or column) the cache self-heals within ~60s instead of serving a stale schema for up to 30
  minutes — fixing silently-wrong writes after a configuration change. Degrades gracefully to a
  coarse time-bucketed refresh when the endpoint is unavailable.
- **Per-tenant schema-cache isolation** — schema/metadata caches are keyed by Creatio base URL, so a
  `gateway`-mode deployment serving multiple instances (via `X-Creatio-Base-Url`) never serves one
  tenant's schema or metadata to another.

### Changed

- **Keep-alive reuse** — the single-session keep-alive tick (`legacy`/`client_credentials`) now also
  refreshes the schema-freshness snapshot, so its periodic ping doubles as a cache-freshness check
  rather than a bare round-trip.

### Docs

- README: concrete `delegated` / `gateway` setup examples showing what to inject and where (the
  `Authorization: Bearer …` header, plus `X-Creatio-Base-Url` for multi-tenant routing), and that
  the gateway injects a Bearer token only.

### Tests

- **570 tests, 94.6% line coverage.** New suites: secret redaction (+ error scrubbing at the tool
  boundary and the log line), ClientCache hash client, schema-freshness gate (TTL, per-base-url
  keying, degraded fallback), schema-freshness integration across both CRUD backends, and the
  keep-alive warm passthrough. The schema-freshness path was live-verified against a real Creatio.

## [0.6.3]

Security/perf/architecture remediation (from a full re-review) plus broker production-readiness.
Live-regressed across all transports vs a real Creatio; 537 tests, 94.5% line coverage.

### Security

- **Broker access tokens are audience-bound** — `aud` (the `/mcp` resource) + `iss` (origin) are
  set and verified on every `/mcp` call, so a token minted by one deployment is rejected by another
  sharing `CREATIO_MCP_JWT_SECRET` (token redirection / confused-deputy). `client_id` is bound and
  enforced on refresh.
- **`refresh_token` grant** (rotating, single-use, client-bound, gated on the broker still holding
  the user's Creatio tokens) — replaces a previously non-redeemable refresh token; standalone
  clients no longer re-consent hourly.
- **`CREATIO_MCP_JWT_SECRET` hardening** — minimum 32 chars enforced; **required in production**
  (fail-closed); ephemeral-with-warning only outside production.
- **SSRF guard** for the gateway `X-Creatio-Base-Url` override — `CREATIO_MCP_ALLOWED_BASE_URLS`
  allowlist; cloud-metadata link-local addresses always blocked.
- **OData identifier-injection guard**, **log redaction** of `code`/`state`/`token` query params,
  and **bounded DCR client store** (TTL + cap).
- **RFC 7009 `POST /revoke`** (logout) — revokes the Creatio token upstream
  (`/connect/revocation`, best-effort) and purges server-side + issued-refresh tokens; always `200`.

### Added

- **`broker` auth mode** — the MCP acts as its own OAuth 2.1 authorization server for clients (DCR +
  `/authorize` + `/token`) and brokers the user login to Creatio via authorization_code + PKCE,
  holding the user's Creatio tokens server-side. The "connect → authorize → work as me" UX for
  standalone direct clients (Claude Desktop / ChatGPT). Selected via `CREATIO_MCP_AUTH_MODE=broker`.
- **Pluggable broker token store** — `CREATIO_MCP_TOKEN_STORE=memory` (default) | `redis`. The
  Redis store (`CREATIO_MCP_REDIS_URL`) encrypts tokens at rest (AES-256-GCM;
  `CREATIO_MCP_TOKEN_ENC_KEY` or derived from the JWT secret) with native TTL → stateless,
  restart-durable, horizontally-scalable broker.
- **`CREATIO_MCP_PUBLIC_URL`** — pins issuer/audience/redirects/discovery to the external origin
  behind a TLS-terminating proxy.
- **Proactive session keep-alive** (`CREATIO_MCP_KEEPALIVE_SECONDS`, default `300`s, `0` disables)
  for `legacy`/`client_credentials`; reactive reconnect now also recovers from a login-page bounce,
  not only `401`.

### Changed

- **Unified env scheme** — two prefixes, `CREATIO_*` (reach + auth Creatio) and `CREATIO_MCP_*`
  (MCP behavior), with a single declarative back-compat alias table (legacy names still work with a
  one-time deprecation notice). Single `CREATIO_MCP_AUTH_MODE` selector (explicit or inferred:
  legacy → client_credentials → delegated).
- **Per-session `McpServer`** — each transport/session gets its own `McpServer` (a shared singleton
  rejected a second concurrent session's `connect()` with "Already connected to a transport").
- **Performance** — tuned global undici keep-alive dispatcher for outbound Creatio calls;
  single-flight token refresh (no thundering herd); O(1) `describe-entity` via metadata indexes;
  compact (non-pretty) tool output; capability-probe negative-cache.
- **Architecture/DRY** — `createAuthEdge` factory (auth-strategy out of `HttpServer`);
  `httpServer.ts` → `http-server.ts`; shared identifier/probe/expiry helpers; OData read +
  `getCurrentUserInfo` onto the shared `request()` helper; mutation audit now records outcome.
- **Lint** — `@typescript-eslint/member-ordering` rule codifies the class-member convention.

### Tests

- Coverage raised to **94.5% lines** (537 tests). Added the broker full-stack API suite
  (supertest) and an opt-in real-Redis integration test (auto-skips without Redis).

### CI

- Auto-create a **GitHub Release** from the CHANGELOG section on a `v*` tag push (+ a manual
  backfill path), alongside the existing Docker multi-arch publish.

## [0.6.2]

### Added

- **Docker stdio transport** — `MCP_TRANSPORT` env (`http` default | `stdio`) selects the run
  mode in the container (stdio via `docker run -i`); both transports read the same env.

### Fixed

- Declare **`express`** and **`zod`** as direct `dependencies` (previously resolved only
  transitively through the MCP SDK) — required for a correct `--omit=dev` runtime image.

### Changed

- **Docker image** rebuilt as a multi-stage build on **`node:24-alpine`**, running the compiled
  `dist/` (no `ts-node`/devDeps at runtime) via `docker-entrypoint.sh`.
- CI: GitHub Actions bumped to their Node24 majors (clears the Node20 deprecation); the
  publish workflow syncs the README to the Docker Hub repository overview.

### Docs

- AGENTS.md: run modes & deployment, DataService wire-value gotchas (verified vs core/devkit),
  engineering-principles section. README: Docker HTTP/stdio examples + `MCP_TRANSPORT`/`PORT`.

## [0.6.1]

### Added

- **Capability kill-switches** — `DISABLE_DATAFORGE` and `DISABLE_GLOBAL_SEARCH` env flags.
  When set, the capability is neither probed at startup (no network / no token spend) nor
  registered as a tool, even on an environment where it is available. `describe-entity` then
  falls back to the active CRUD backend instead of DataForge.

### Docs

- AGENTS.md: mandatory release checklist (bump → changelog → build/test → commit → tag →
  push → npm publish), engineering-principles section (SOLID / GRASP / Clean Code / patterns),
  tests-are-part-of-done rule, and the new disable flags. README env table updated.

## [0.6.0]

### Added

- **Selectable CRUD backend** — OData or **DataService** (Creatio's native data API, now the
  default), chosen per-deployment via `CREATIO_CRUD_BACKEND`. Full DataService provider:
  read/create/update/delete, schema discovery via `RuntimeEntitySchemaRequest`, entity listing
  via `VwSysSchemaInWorkspace`, and metadata-driven value coercion.
- **Neutral query contract** (`ReadQuery` / `FilterNode` AST / `ReadResult`) with a per-backend
  translator (Strategy): the MCP layer is dialect-agnostic; each backend owns its translation.
- **Capability-driven read params** — the OData-only `filter` (raw `$filter`) and `expand`
  parameters are registered only when the active backend supports them.

### Fixed

- 10 issues found via live regression across both backends, incl.: OData ISO date/datetime
  literals now emitted unquoted (`Edm.Date`/`Edm.DateTimeOffset`); `describe-entity` `source`
  reflects the active backend; DataService `FilterComparisonType` wire values corrected
  (gt/ge/lt/le/contains/endswith); `list-entities` de-duplication; lookup-FK select/path
  normalization; primary-column (`Photo`) projection; count/`top:0` handling; extended→base
  `DataValueType` coercion; lookup-FK write mapping; quoted profile-tz DateTime parameters; and
  the explicit `IsNull` flag (fixes inverted `isNotNull`).

### Changed

- `services/` restructured into symmetric `odata/` and `dataservice/` folders; shared
  `assertEntityName` / `lookupIdPath` helpers; `odataRoot` moved into the OData layer so the
  shared HTTP client stays transport-only.

## [0.5.1]

### Changed

- Architecture audit refactor: `ICreatioAuthProvider` split by capability (ISP/LSP) into
  core + `IRevocable` + `IInteractive`; directory rename `providers → contracts`,
  `services → sessions`; `server.ts` God-method slimmed into a declarative tool table;
  centralized `CreatioHttpClient.request()` helper; idle-TTL eviction of session user tokens.

## [0.5.0]

### Added

- **DataForge** env-gated MCP tools (semantic data-model layer) + `describe-entity` routing.
- **Global Search** tool, plus hardened structured read lookup filters.
- **Read pagination** (`$skip`) and **total count** (`$count`) with a default page size.
- **Published-tools proxy** — surfaces tools published in the in-Creatio CrtMCPPublishingApp
  (hidden, env-gated via `ENABLE_PUBLISHED_TOOLS`).
- CRUD backend selection seam + DataService groundwork.
- Engine layer earns its place: cross-cutting readonly guard + audit trail.

## [0.4.1]

### Changed

- Publish only `dist/` to npm (added `files` whitelist).
- Dependency bumps (TypeScript, `@types/node`, `fast-xml-parser`).
- Testing made mandatory; coverage raised to 90%+ across statements/functions/lines.

## [0.3.0]

- Baseline: Creatio MCP server (CRUD, schema inspection, process execution, sys settings,
  admin operations) over OData, with stdio + HTTP run modes and legacy/OAuth2 authentication.

[0.6.4]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.4
[0.6.3]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.3
[0.6.2]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.2
[0.6.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.1
[0.6.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.0
[0.5.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.5.1
[0.5.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.5.0
[0.4.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.4.1
[0.3.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.3.0
