import type {
	OAuthAuthorizationRequest,
	OAuthClient,
	OAuthError,
	OAuthTokenRequest,
} from './types';
const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class OAuthValidators {
	/**
	 * Restricts OAuth redirect targets to loopback web addresses (native-app local
	 * listeners) and custom app-scheme deep links, blocking redirects to arbitrary
	 * remote origins and script-bearing schemes (open redirect / code interception, CWE-601).
	 */
	public static isAllowedRedirectUri(uri: string): boolean {
		let parsed: URL;
		try {
			parsed = new URL(uri);
		} catch {
			return false;
		}
		const proto = parsed.protocol.toLowerCase();
		if (DANGEROUS_SCHEMES.has(proto)) {
			return false;
		}
		if (proto === 'http:' || proto === 'https:') {
			return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
		}
		// Any other custom scheme (e.g. vscode:, cursor:, com.example.app:) is an app deep link.
		return true;
	}

	public static validateAuthorizationRequest(
		params: OAuthAuthorizationRequest,
		client: OAuthClient | undefined,
	): OAuthError | null {
		if (!client) {
			return { error: 'invalid_client', error_description: 'Client not found' };
		}
		if (!client.redirect_uris.includes(params.redirect_uri)) {
			return { error: 'invalid_request', error_description: 'Invalid redirect_uri' };
		}
		if (params.response_type !== 'code') {
			return { error: 'unsupported_response_type' };
		}
		if (!params.code_challenge || params.code_challenge_method !== 'S256') {
			return { error: 'invalid_request', error_description: 'PKCE required' };
		}
		return null;
	}

	public static validateTokenRequest(params: OAuthTokenRequest): OAuthError | null {
		if (params.grant_type !== 'authorization_code') {
			return { error: 'unsupported_grant_type' };
		}
		if (!params.code || !params.code_verifier) {
			return { error: 'invalid_request', error_description: 'Missing code or code_verifier' };
		}
		return null;
	}

	public static validateClientRegistration(redirect_uris: unknown): string | null {
		if (!redirect_uris || !Array.isArray(redirect_uris)) {
			return 'redirect_uris is required and must be an array';
		}
		if (redirect_uris.length === 0) {
			return 'redirect_uris must contain at least one URI';
		}
		for (const uri of redirect_uris) {
			if (typeof uri !== 'string') {
				return 'All redirect_uris must be strings';
			}
			try {
				new URL(uri);
			} catch {
				return `Invalid redirect_uri: ${uri}`;
			}
			if (!OAuthValidators.isAllowedRedirectUri(uri)) {
				return `Disallowed redirect_uri (must be loopback or an app scheme): ${uri}`;
			}
		}
		return null;
	}
}
