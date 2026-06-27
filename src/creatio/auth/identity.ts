/**
 * Canonical Creatio identity base: an explicit `idBaseUrl` when given, otherwise the instance base
 * URL, in both cases normalized to end with the `/0` workspace segment (where Creatio hosts the
 * OAuth/OIDC endpoints, e.g. `/0/connect/token`, `/0/.well-known/openid-configuration`). Shared by
 * the client-credentials provider and the delegated-mode JWKS validator so they target the same host.
 */
export function resolveIdentityBase(baseUrl: string, idBaseUrl?: string): string {
	const raw = idBaseUrl ? String(idBaseUrl) : baseUrl;
	let base = raw.replace(/\/$/, '');
	if (!/\/0$/.test(base)) {
		base = base + '/0';
	}
	return base;
}
