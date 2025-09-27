import { AuthProviderType } from './providers';

export interface ICreatioAuthProvider {
	type: AuthProviderType;
	getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;
	refresh(): Promise<void>;
	revoke(): Promise<void>;
	getAuthorizeUrl(state: string): Promise<string>;
	finishAuthorization(code: string): Promise<void>;
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
