/** Builds the standard Creatio request headers, optionally with a JSON content-type and a Bearer token. */
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

/**
 * Builds Creatio request headers for a Forms-auth (cookie) session: the base headers plus the
 * session `Cookie`, its `BPMCSRF` anti-forgery token, and `ForceUseSession` so Creatio honours the
 * cookie session. Single source of the cookie-header convention, shared by the legacy self-login
 * provider and the stateless gateway/delegated cookie passthrough.
 */
export function buildCookieHeaders(
	accept: string,
	isJson: boolean,
	cookie: string,
	bpmcsrf?: string,
): Record<string, string> {
	const headers = buildHeaders(accept, isJson);
	headers['ForceUseSession'] = 'true';
	headers['Cookie'] = cookie;
	if (bpmcsrf) {
		headers['BPMCSRF'] = bpmcsrf;
	}
	return headers;
}
