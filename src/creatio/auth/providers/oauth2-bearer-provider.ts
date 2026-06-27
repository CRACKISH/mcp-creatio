import { getBearerToken } from '../../../utils';
import { BearerAuthConfig } from '../../client-config';
import { buildHeaders } from '../auth';

import { BaseProvider } from './base-provider';

/**
 * Stateless per-request Bearer passthrough provider.
 *
 * The MCP issues and stores no tokens: every request already carries a Creatio access token
 * (obtained by the client from Creatio Identity in `delegated` mode, or injected by a trusted
 * Control-Plane in `gateway` mode). This provider simply attaches that token — read from the
 * per-request {@link getBearerToken} context — to outgoing Creatio calls. Token acquisition and
 * refresh are the client's / gateway's responsibility, which is why there is nothing to refresh
 * here and no server-side token store.
 */
export class OAuth2BearerProvider extends BaseProvider<BearerAuthConfig> {
	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		const token = getBearerToken();
		if (!token) {
			// No token in context ⇒ unauthenticated request. The HTTP edge turns this into a 401
			// (delegated: with a WWW-Authenticate challenge; gateway: a plain rejection).
			throw new Error('bearer_token_required');
		}
		return buildHeaders(accept, Boolean(isJson), token);
	}

	public async refresh(): Promise<void> {
		// Nothing to refresh: the client (delegated) or gateway owns the token lifecycle. A stale
		// token surfaces as a 401 from Creatio, which the caller resolves by presenting a fresh one.
	}
}
