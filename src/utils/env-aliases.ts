/**
 * A legacy environment-variable name superseded by a canonical one.
 */
interface LegacyAlias {
	/** The old variable name to fall back to when the canonical one is unset. */
	readonly name: string;
	/**
	 * Whether using it emits a one-time deprecation notice. `false` for names we keep supporting on
	 * purpose (platform conventions such as `PORT`); `true` for variables renamed under the unified
	 * `CREATIO_` / `CREATIO_MCP_` scheme.
	 */
	readonly deprecated: boolean;
}

/**
 * Single source of truth for backward-compatible environment names: each CANONICAL variable maps to
 * the legacy names it superseded. Centralizing it here means the rename never leaks ad-hoc fallbacks
 * across the codebase — call sites read only canonical names and this layer resolves the rest.
 *
 * These legacy names are intentionally undocumented; they exist only so an early adopter who already
 * set an old name keeps working (with a deprecation notice) until they migrate.
 */
const LEGACY_ALIASES: Readonly<Record<string, readonly LegacyAlias[]>> = {
	// Platform convention — kept indefinitely, no deprecation notice.
	CREATIO_MCP_PORT: [{ name: 'PORT', deprecated: false }],
	// Renamed under the unified scheme — supported transitionally with a deprecation notice.
	CREATIO_MCP_LOG_LEVEL: [{ name: 'MCP_CREATIO_LOG_LEVEL', deprecated: true }],
	CREATIO_MCP_READONLY: [{ name: 'READONLY_MODE', deprecated: true }],
	CREATIO_MCP_CRUD_BACKEND: [{ name: 'CREATIO_CRUD_BACKEND', deprecated: true }],
	CREATIO_MCP_DISABLE_DATAFORGE: [{ name: 'DISABLE_DATAFORGE', deprecated: true }],
	CREATIO_MCP_DISABLE_GLOBAL_SEARCH: [{ name: 'DISABLE_GLOBAL_SEARCH', deprecated: true }],
	CREATIO_MCP_ENABLE_PUBLISHED_TOOLS: [{ name: 'ENABLE_PUBLISHED_TOOLS', deprecated: true }],
	CREATIO_MCP_TRANSPORT: [{ name: 'MCP_TRANSPORT', deprecated: true }],
};

const _warned = new Set<string>();

/**
 * Emits the deprecation notice straight to stderr (not the structured logger) on purpose: the
 * logging module resolves its own level through `env()`, so depending on it here would create an
 * env ↔ log import cycle. A one-line stderr notice keeps this layer self-contained.
 */
function noticeOnce(alias: string, canonical: string): void {
	if (_warned.has(alias)) {
		return;
	}
	_warned.add(alias);
	process.stderr.write(
		`[mcp-creatio] Environment variable "${alias}" is deprecated; use "${canonical}" instead.\n`,
	);
}

/**
 * Resolves a legacy value for a canonical variable when the canonical one is unset. Returns the
 * first legacy alias that holds a value (notifying once per deprecated alias actually used), or
 * `undefined` when the variable has no aliases / none are set.
 *
 * `read` is injected (DIP) so this stays decoupled from how a raw env value is fetched/normalized.
 */
export function resolveLegacyEnv(
	canonical: string,
	read: (name: string) => string | undefined,
): string | undefined {
	const aliases = LEGACY_ALIASES[canonical];
	if (!aliases) {
		return undefined;
	}
	for (const alias of aliases) {
		const value = read(alias.name);
		if (value === undefined) {
			continue;
		}
		if (alias.deprecated) {
			noticeOnce(alias.name, canonical);
		}
		return value;
	}
	return undefined;
}
