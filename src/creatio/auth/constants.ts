/** Creatio Identity endpoints, relative to the identity base (see {@link resolveIdentityBase}). */
export const TOKEN_ENDPOINT = '/connect/token';
export const AUTHORIZE_ENDPOINT = '/connect/authorize';
export const REVOCATION_ENDPOINT = '/connect/revocation';
/** Max bytes of a token-endpoint error body to log, so diagnostics never dump huge payloads. */
export const TOKEN_BODY_SNIPPET_MAX = 1024;
/** Safety margin (seconds) subtracted from a token's lifetime so it is refreshed before it expires. */
export const EXPIRES_MARGIN_SECONDS = 30;
/** PKCE challenge method the broker always uses on the Creatio leg. */
export const PKCE_S256 = 'S256';

/** Absolute expiry (epoch ms) for a token living `expiresInSeconds`, minus the safety margin so it
 *  is refreshed before it actually expires. The single source of truth for token-expiry math. */
export function computeTokenExpiryMs(expiresInSeconds: number, minSeconds = 1): number {
	return Date.now() + Math.max(minSeconds, expiresInSeconds - EXPIRES_MARGIN_SECONDS) * 1000;
}
