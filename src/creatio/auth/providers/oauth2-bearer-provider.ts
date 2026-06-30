import { getInjectedCredential } from '../../../utils';
import { BearerAuthConfig } from '../../client-config';
import { buildCookieHeaders, buildHeaders } from '../auth';

import { BaseProvider } from './base-provider';

/**
 * Stateless per-request credential passthrough provider (delegated / gateway).
 *
 * The MCP issues and stores no tokens: every request already carries a Creatio credential — obtained
 * by the client from Creatio Identity in `delegated` mode, or injected by a trusted Control-Plane in
 * `gateway` mode. This provider reads that credential from the per-request {@link getInjectedCredential}
 * context and formats the matching headers: a Bearer token, or a Forms-auth session (Cookie + BPMCSRF
 * + ForceUseSession). It holds no cookie jar and needs no client pool — the headers are rebuilt from
 * the context on every call. Token/session acquisition and refresh are the client's / gateway's
 * responsibility, which is why there is nothing to refresh here.
 */
export class OAuth2BearerProvider extends BaseProvider<BearerAuthConfig> {
	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		const credential = getInjectedCredential();
		if (!credential) {
			// No credential in context ⇒ unauthenticated request. The HTTP edge turns this into a 401
			// (delegated: with a WWW-Authenticate challenge; gateway: a plain rejection).
			throw new Error('credential_required');
		}
		if (credential.kind === 'cookie') {
			return buildCookieHeaders(accept, Boolean(isJson), credential.cookie, credential.bpmcsrf);
		}
		return buildHeaders(accept, Boolean(isJson), credential.token);
	}

	public async refresh(): Promise<void> {
		// Nothing to refresh: the client (delegated) or gateway owns the credential lifecycle. A stale
		// token/session surfaces as a 401 from Creatio, which the caller resolves by presenting a fresh
		// one.
	}
}
