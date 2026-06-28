/**
 * Guards the gateway-only `X-Creatio-Base-Url` override. The override decides where each request's
 * Bearer token is sent, so an unvalidated value is an SSRF / token-redirection lever (CWE-918):
 * a compromised or misconfigured gateway could redirect the authenticated token to an attacker host
 * or pivot to internal metadata endpoints.
 *
 * The real production control is an allowlist (`CREATIO_MCP_ALLOWED_BASE_URLS`). When it is set, the
 * override MUST fall under an allowed origin. When it is NOT set, we keep the trusted-gateway posture
 * (any http/https host is accepted) but ALWAYS block the cloud-metadata link-local address, since it
 * is never a legitimate Creatio target and is the classic SSRF prize. On-prem private ranges are NOT
 * blocked by default — legitimate tenants live there — so use the allowlist to lock things down.
 */

/** Cloud instance-metadata endpoints (AWS/GCP/Azure IMDS) — never a Creatio base, always blocked. */
const BLOCKED_HOSTS = new Set(['169.254.169.254', 'fd00:ec2::254', '[fd00:ec2::254]']);

/** Parse the comma/space-separated `CREATIO_MCP_ALLOWED_BASE_URLS` into normalized origins. */
export function parseAllowedBaseUrls(raw: string | undefined): string[] {
	if (!raw) {
		return [];
	}
	return raw
		.split(/[\s,]+/)
		.map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
		.filter(Boolean);
}

/**
 * Whether `raw` is an acceptable base-URL override. `allowlist` is the parsed
 * {@link parseAllowedBaseUrls} list ([] = none configured).
 */
export function isAllowedBaseUrl(raw: string, allowlist: string[]): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	const scheme = url.protocol.toLowerCase();
	if (scheme !== 'http:' && scheme !== 'https:') {
		return false;
	}
	const host = url.hostname.toLowerCase();
	if (BLOCKED_HOSTS.has(host) || host.startsWith('169.254.')) {
		return false;
	}
	if (allowlist.length === 0) {
		return true;
	}
	const normalized = raw.replace(/\/+$/, '').toLowerCase();
	return allowlist.some(
		(allowed) => normalized === allowed || normalized.startsWith(allowed + '/'),
	);
}
