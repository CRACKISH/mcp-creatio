import { workspaceBaseUrl } from '../workspace-mount';

const ENDS_WITH_MOUNT = /\/0$/;

/**
 * Canonical Creatio identity base, where Creatio hosts the OAuth/OIDC endpoints (`connect/token`,
 * `.well-known/openid-configuration`). An explicit `idBaseUrl` is normalized to end with `/0` (its
 * long-standing contract). Otherwise it is the instance's workspace base — `{base}/0` on .NET
 * Framework, `{base}` on .NET 8, where `/0/connect/*` does not exist (see {@link workspaceBaseUrl}).
 * Shared by the client-credentials provider and the broker's Creatio OAuth client.
 */
export async function resolveIdentityBase(baseUrl: string, idBaseUrl?: string): Promise<string> {
	if (idBaseUrl) {
		const base = String(idBaseUrl).replace(/\/$/, '');
		return ENDS_WITH_MOUNT.test(base) ? base : `${base}/0`;
	}
	const base = baseUrl.replace(/\/$/, '');
	return ENDS_WITH_MOUNT.test(base) ? base : workspaceBaseUrl(base);
}
