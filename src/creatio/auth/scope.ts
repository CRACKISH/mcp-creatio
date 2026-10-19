/** The scope that makes Creatio Identity issue a refresh token (authorization_code flows only). */
export const OFFLINE_ACCESS_SCOPE = 'offline_access';

// RFC 6749 §3.3 scope-token: printable ASCII except space, `"` and `\`.
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
// Space is the OAuth wire delimiter; commas are also accepted because space-separated values are
// awkward to pass through env files / container orchestrators.
const SCOPE_SEPARATOR = /[\s,]+/;

/**
 * Parses a user-supplied scope list into unique, RFC 6749-valid tokens (order preserved). Throws
 * on an invalid token so a misconfiguration fails at startup, not as a 401 on the first API call.
 */
export function parseScopes(raw: string | undefined): string[] {
	const tokens = (raw ?? '').split(SCOPE_SEPARATOR).filter(Boolean);
	const invalid = tokens.find((token) => !SCOPE_TOKEN.test(token));
	if (invalid !== undefined) {
		throw new Error(`invalid_oauth_scope:${invalid}`);
	}
	return [...new Set(tokens)];
}

/**
 * Scopes for a user (authorization_code) flow: `offline_access` so a refresh token is issued, plus
 * the configured resource scopes. Creatio versions without the `AddApplicationAccessScopeAutomatically`
 * feature also need the app's `ApplicationAccess_<id>` scope here, or every API call returns 401.
 */
export function withOfflineAccess(scopes: readonly string[] = []): string[] {
	return [...new Set([OFFLINE_ACCESS_SCOPE, ...scopes])];
}
