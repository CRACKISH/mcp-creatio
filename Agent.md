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
  server/             ← MCP server + HTTP layer (OAuth server, handlers)
    mcp/              ← MCP tool descriptors, prompts, filters builder
    oauth/            ← Local OAuth 2.1 authorization server for clients
  services/           ← Session/token refresh orchestration
  utils/              ← Reusable helpers (env, network, pkce, context)
  types/              ← Shared TypeScript interfaces & DTO shapes
```

Key flows:

1. Client authenticates (legacy credentials OR OAuth2 variants).
2. MCP server registers tools using descriptors from `server/mcp/tools-data.ts`.
3. Tool handlers call into `CreatioEngineManager`, which resolves a `CreatioServiceContext` (built from `src/creatio/services/*`) and delegates work to the appropriate provider (CRUD, process, sys-settings, user).
4. Responses are normalized into MCP content blocks.

### Creatio Service Stack (LLM Cheat Sheet)

```
CreatioServiceContext
  ├─ CreatioAuthManager → selects concrete auth provider (legacy / OAuth2 / OAuth2 code)
  ├─ CreatioHttpClient → transport + logging + retry + header helpers
  ├─ ODataMetadataStore → caches entity schemas per environment
  ├─ ODataCrudProvider → implements CrudProvider using http + metadata
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
- `CreatioHttpClient` should stay transport-focused (auth headers, retries, timing). Keep endpoint-specific logic inside providers or a dedicated endpoint helper.

## 3. Core Modules You Will Touch

| Area                         | File(s)                          | Notes                                                                                                        |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tool registration            | `src/server/mcp/server.ts`       | Add/remove tool handlers; keep descriptors in separate file.                                                 |
| Tool schemas & text guidance | `src/server/mcp/tools-data.ts`   | Use `zod` schemas; detailed descriptions help AI reasoning.                                                  |
| Filters logic                | `src/server/mcp/filters.ts`      | Converts structured JSON filters into OData `$filter` strings.                                               |
| Prompts                      | `src/server/mcp/prompts-data.ts` | Pre-baked instructional prompts consumed by clients.                                                         |
| Creatio API                  | `src/creatio/services/*`         | `CreatioServiceContext` composes auth + http client + providers; extend providers instead of bypassing them. |
| OAuth for clients            | `src/server/oauth/*`             | Maintains tokens for MCP clients; ephemeral memory by default.                                               |

## 4. Invariants & Rules (Do NOT Break)

1. All date/time fields passed to Creatio MUST be UTC ISO8601 with `Z` suffix.
2. Activity creation: Always set `OwnerId` and `AuthorId` to current user's ContactId obtained via `get-current-user-info` unless user explicitly specifies another owner.
3. Avoid adding blocking network calls in tool descriptors—descriptors must be static; logic belongs in handlers.
4. Never silently swallow errors coming from Creatio—log via `log.error` then rethrow.
5. Keep tool names stable: lowercase kebab-case (e.g. `execute-process`).
6. Keep authentication precedence: Authorization Code > Client Credentials > Legacy.
7. Do not leak secrets or access tokens in tool responses.
8. `READONLY_MODE=true` must guarantee no mutation tools (`create`, `update`, `delete`, `execute-process`, `set-sys-settings-value`, `create-sys-setting`, `update-sys-setting-definition`, `refresh-feature-cache`, `upsert-admin-operation`, `delete-admin-operation`, `set-admin-operation-grantee`, `delete-admin-operation-grantee`, `call-configuration-service`) are registered.

## 5. Adding a New Tool (Checklist)

1. Define input shape in `tools-data.ts` using `zod`.
2. Provide rich description (include examples, edge cases, warnings).
3. Export descriptor & input schema.
4. Register in `server.ts` via `_registerHandlerWithDescriptor` (respect readonly mode if mutating).
5. Implement the handler by calling the appropriate provider on the `CreatioServiceContext` (via `CreatioEngineManager`); if functionality is missing, extend or add a provider under `src/creatio/services` rather than issuing raw fetch calls.
6. Ensure responses are formatted as `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` when not already MCP native.
7. Add edge-case validation (empty arrays, invalid GUID, missing required filter fields).
8. **Write tests** (see §10): a `server.test.ts` case asserting the handler delegates + readonly gating, plus provider-level tests via `makeHttpClientHarness` for any new `src/creatio/services` code. Run `npm run test:coverage` and stay ≥90%.
9. Update documentation (README if public feature; otherwise just Agent.md).

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
  api/         ← supertest against the real Express app (HTTP/OAuth/MCP routes)
  support/     ← shared test harness (USE THESE, do not reinvent)
    http-client.ts   → makeHttpClientHarness(responder), jsonResponse, textResponse, bodyOf
    fake-context.ts  → makeFakeContext(authType) — a full CreatioProviderContext of vi.fn() stubs
    test-server.ts   → createTestServer(), createAuthProviderMock(), resetSessionContext()
```

Tests live **outside `src/`** so the `tsc` build stays clean. Name files `*.test.ts`. Keep the logger quiet (the vitest config already sets `MCP_CREATIO_LOG_LEVEL=silent`).

### Which level to use (pick the closest to what you changed)

| You changed… | Test it like this |
| --- | --- |
| A pure function (filters, validators, pkce, env, key formatting) | Plain unit test, no mocks. |
| A **service provider** (`src/creatio/services/*`) | `makeHttpClientHarness(responder)` gives a real `CreatioHttpClient` + stubbed `fetch`. Assert the request URL/method/body (`bodyOf(calls[0])`) and the parsed result. Cover the non-2xx error path too. |
| A **tool handler / registration** (`server.ts`) | `new Server(new CreatioEngineManager(makeFakeContext()), {...})`, then invoke `(server as any)._handlers.get('tool-name')(payload)` and assert the provider stub was called. Also assert readonly-mode gating. |
| An **HTTP / OAuth / MCP endpoint** | `createTestServer()` → `supertest(app)`. Call `resetSessionContext()` in `beforeEach`. Assert status codes, redirects, and that secrets/identity are handled correctly. |
| An **auth provider** | `vi.stubGlobal('fetch', vi.fn(...))` for the token endpoint, wrap calls in `runWithContext({ userKey })`, seed/read `SessionContext.instance`. |
| **Time- or concurrency-sensitive** code (TTL, refresh, schedulers) | `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)`; for dedup, fire N concurrent calls with `Promise.all` and assert the underlying op ran once. |

### Conventions

- Reset shared singletons (`SessionContext.instance`) with `resetSessionContext()` between tests; build fresh `RateLimiter`/`HttpServer`/providers per test.
- Prefer driving real code through the harness over asserting on mocks-of-mocks. Service-provider tests use a **real** `CreatioHttpClient`; only `fetch` is stubbed.
- Cover the unhappy paths explicitly (4xx/5xx, parse failure, expired, missing token/identity) — that is where the bugs are.
- Process entry points (`cli.ts`, `index.ts`) are excluded from coverage; unit-test their pure helpers instead.

## 11. Versioning & Release

- Increment `package.json` version; code reads dynamically via `src/version.ts`.
- Use semantic prefixes in commits: `feat:`, `fix:`, `docs:`, `chore:`.
- Tag releases: `git tag vX.Y.Z && git push --tags` (manual unless automated later).

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

1. Create provider under `src/creatio/auth/providers/` implementing shared interface.
2. Add selection logic in `auth-manager.ts` maintaining precedence ordering.
3. Document environment variables clearly in README + Agent.md.

## 14. Prompts Extension

- Add new prompt object in `prompts-data.ts` (`name`, `title`, `description`, `argsSchema`, `callback`).
- Keep names unique and descriptive.
- Avoid external network calls inside prompt callbacks.

## 15. Code Style

Baseline rules live in `docs/coding-style.md`. Highlights:

- Keep TypeScript strict (avoid `any`, prefer explicit interfaces).
- Follow the class-member ordering guide (readonly fields → fields → getters → setters → constructor → methods, each ordered `private → protected → public`).
- Prefix private fields/methods with `_`.
- Use existing utility wrappers (e.g., `withValidation`).
- Keep functions small; single responsibility.
- Reuse logging tags already established.

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

- Implement persistent token storage (e.g., file/Redis) for OAuth tokens.
- Provide structured error codes instead of raw messages.
- Raise branch coverage toward 90% and wire `npm test` into CI.
- Move the raw OData `$filter` to a fully structured contract (reduce injection surface).

## 19. Contact Points

If you need business logic clarification, check existing descriptor guidance first. Many patterns (date handling, ownership) are documented inline in `tools-data.ts`.

---

**Summary:** Focus on safe MCP tool extension around Creatio CRM. Preserve invariants, keep descriptors rich, centralize API interactions, and avoid leaking credentials.
