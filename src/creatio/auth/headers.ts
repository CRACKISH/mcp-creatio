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
