import { AuthProviderType } from './providers';

/**
 * Core capability every auth provider has: attach auth headers, refresh on 401, and a
 * safe cancel hook for background timers. Kept deliberately small (ISP) — revocation and
 * the interactive authorization-code dance are separate, optional capabilities below, so
 * a provider is never forced to stub methods it does not support.
 */
export interface ICreatioAuthProvider {
	type: AuthProviderType;
	getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;
	refresh(): Promise<void>;
	/** Cancels any background token-refresh timers. Safe no-op for providers without them. */
	cancelAllRefresh(): void;
}

/** A provider whose tokens can be explicitly revoked (OAuth2 variants). */
export interface IRevocableAuthProvider extends ICreatioAuthProvider {
	revoke(): Promise<void>;
}

/** A provider that drives the interactive OAuth2 authorization-code flow. */
export interface IInteractiveAuthProvider extends ICreatioAuthProvider {
	getAuthorizeUrl(state: string): Promise<string>;
	finishAuthorization(code: string): Promise<void>;
}

export function supportsRevoke(provider: ICreatioAuthProvider): provider is IRevocableAuthProvider {
	return typeof (provider as Partial<IRevocableAuthProvider>).revoke === 'function';
}

export function supportsInteractiveAuth(
	provider: ICreatioAuthProvider,
): provider is IInteractiveAuthProvider {
	const p = provider as Partial<IInteractiveAuthProvider>;
	return typeof p.getAuthorizeUrl === 'function' && typeof p.finishAuthorization === 'function';
}

export function buildHeaders(
	accept: string,
	isJson?: boolean,
	token?: string,
): Record<string, string> {
	const headers: Record<string, string> = { Accept: accept };
	if (isJson) {
		headers['Content-Type'] = 'application/json';
	}
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

export const TOKEN_ENDPOINT = '/connect/token';
export const AUTHORIZE_ENDPOINT = '/connect/authorize';
export const REVOCATION_ENDPOINT = '/connect/revocation';
export const TOKEN_BODY_SNIPPET_MAX = 1024;
export const EXPIRES_MARGIN_SECONDS = 30;
