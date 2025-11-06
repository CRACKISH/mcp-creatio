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
3. Tool handlers delegate to `CreatioClient` (in `src/creatio/client.ts`).
4. Responses are normalized into MCP content blocks.

## 3. Core Modules You Will Touch

| Area                         | File(s)                          | Notes                                                                   |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Tool registration            | `src/server/mcp/server.ts`       | Add/remove tool handlers; keep descriptors in separate file.            |
| Tool schemas & text guidance | `src/server/mcp/tools-data.ts`   | Use `zod` schemas; detailed descriptions help AI reasoning.             |
| Filters logic                | `src/server/mcp/filters.ts`      | Converts structured JSON filters into OData `$filter` strings.          |
| Prompts                      | `src/server/mcp/prompts-data.ts` | Pre-baked instructional prompts consumed by clients.                    |
| Creatio API                  | `src/creatio`                    | `client.ts` is the abstraction; avoid duplicating HTTP logic elsewhere. |
| OAuth for clients            | `src/server/oauth/*`             | Maintains tokens for MCP clients; ephemeral memory by default.          |

## 4. Invariants & Rules (Do NOT Break)

1. All date/time fields passed to Creatio MUST be UTC ISO8601 with `Z` suffix.
2. Activity creation: Always set `OwnerId` and `AuthorId` to current user's ContactId obtained via `get-current-user-info` unless user explicitly specifies another owner.
3. Avoid adding blocking network calls in tool descriptors—descriptors must be static; logic belongs in handlers.
4. Never silently swallow errors coming from Creatio—log via `log.error` then rethrow.
5. Keep tool names stable: lowercase kebab-case (e.g. `execute-process`).
6. Keep authentication precedence: Authorization Code > Client Credentials > Legacy.
7. Do not leak secrets or access tokens in tool responses.
8. `READONLY_MODE=true` must guarantee no mutation tools (`create`, `update`, `delete`, `execute-process`) are registered.

## 5. Adding a New Tool (Checklist)

1. Define input shape in `tools-data.ts` using `zod`.
2. Provide rich description (include examples, edge cases, warnings).
3. Export descriptor & input schema.
4. Register in `server.ts` via `_registerHandlerWithDescriptor` (respect readonly mode if mutating).
5. Implement handler calling the appropriate method on `CreatioClient` (never embed raw fetch logic here—extend the client if needed).
6. Ensure responses are formatted as `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` when not already MCP native.
7. Add edge-case validation (empty arrays, invalid GUID, missing required filter fields).
8. Update documentation (README if public feature; otherwise just Agent.md).

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

## 10. Testing (Minimal Approach)

Currently no formal test suite. For quick validation:

- Start server locally (`npm start`) and manually invoke tools from an MCP client.
- Consider adding lightweight Jest tests for filter builder and client methods (future enhancement).

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

- TypeScript strict types where practical (avoid `any`, prefer explicit interfaces).
- Use existing utility wrappers (e.g., `withValidation`).
- Keep functions small; single responsibility.
- Reuse logging tags already established.

## 16. What NOT To Do

- Do not reintroduce removed tools (`search`, `fetch`) unless strong justification & design review.
- Do not bypass `CreatioClient` with raw fetch calls scattered in handlers.
- Do not embed long multi-megabyte payloads in commit history (limit sample data).

## 17. Quick Start for Agent Changes

1. Make code edits.
2. Run `npm run build` to ensure TypeScript passes.
3. Optionally lint: `npm run lint`.
4. Commit using conventional message.
5. Push; consider tag if version bump.

## 18. Future Enhancements (Suggestions)

- Add Jest test suite for filter builder + auth flows.
- Implement persistent token storage (e.g., file/Redis) for OAuth tokens.
- Add rate limiting to prevent excessive query load.
- Provide structured error codes instead of raw messages.

## 19. Contact Points

If you need business logic clarification, check existing descriptor guidance first. Many patterns (date handling, ownership) are documented inline in `tools-data.ts`.

---

**Summary:** Focus on safe MCP tool extension around Creatio CRM. Preserve invariants, keep descriptors rich, centralize API interactions, and avoid leaking credentials.
