# Changelog

All notable changes to **mcp-creatio** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

[0.6.2]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.2
[0.6.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.1
[0.6.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.6.0
[0.5.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.5.1
[0.5.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.5.0
[0.4.1]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.4.1
[0.3.0]: https://github.com/CRACKISH/mcp-creatio/releases/tag/v0.3.0
