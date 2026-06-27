import { supportsInteractiveAuth, supportsRevoke } from '../../creatio';
import log from '../../log';
import { SessionContext } from '../../sessions';
import { getSessionIdFromRequest, runWithContext } from '../../utils';
import { OAuthValidators } from '../oauth';

import type { Server } from '../mcp';
import type { OAuthServer } from '../oauth';
import type { Request, Response } from 'express';

export class CreatioOAuthHandlers {
	private readonly _sessionContext = SessionContext.instance;
	private readonly _server: Server;
	private readonly _oauthServer: OAuthServer;

	constructor(server: Server, oauthServer: OAuthServer) {
		this._server = server;
		this._oauthServer = oauthServer;
	}

	public async handleOAuthStart(req: Request, res: Response): Promise<void> {
		try {
			const userKey = req.query.userKey as string;
			const authKey = req.query.authKey as string;
			const effectiveUserKey = userKey || authKey;
			if (!effectiveUserKey) {
				res.status(400).send(
					'Missing userKey parameter. Add ?userKey=your_user_key to URL',
				);
				return;
			}
			const provider = this._server.authProvider;
			if (!supportsInteractiveAuth(provider)) {
				res.status(400).send(
					'Authorization-code flow is not enabled for this deployment (configure CREATIO_CODE_* auth)',
				);
				return;
			}
			// Bind the OAuth state to the session that initiated the flow (if any),
			// so the callback maps only that session — never every active session (CWE-639).
			const initiatingSessionId = getSessionIdFromRequest(req) ?? undefined;
			const state = this._sessionContext.createOAuthState(
				effectiveUserKey,
				initiatingSessionId,
			);
			const url = await provider.getAuthorizeUrl(state);
			const mcpParams = req.query as any;
			if (mcpParams.client_id && mcpParams.redirect_uri) {
				const urlObj = new URL(url);
				const stateWithMcp = `${state}&client_id=${mcpParams.client_id}&redirect_uri=${encodeURIComponent(mcpParams.redirect_uri)}&code_challenge=${mcpParams.code_challenge}&code_challenge_method=${mcpParams.code_challenge_method}&mcp_state=${mcpParams.state || ''}`;
				urlObj.searchParams.set('state', stateWithMcp);
				return res.redirect(302, urlObj.toString());
			}
			res.redirect(302, url);
		} catch (err: any) {
			log.error('oauth.start.error', { error: String(err?.message ?? err) });
			res.status(500).send('OAuth start failed');
		}
	}

	public async handleOAuthCallback(req: Request, res: Response): Promise<void> {
		try {
			const code = String(req.query?.code ?? '') || String((req as any).body?.code ?? '');
			const state = String(req.query?.state ?? '') || String((req as any).body?.state ?? '');
			log.info('oauth.callback.start', {
				hasCode: !!code,
				hasState: !!state,
			});
			if (!code || !state) {
				res.status(400).send('Missing code or state');
				return;
			}
			const stateParts = state.split('&');
			const creatioState = stateParts[0];
			log.info('oauth.callback.state_parse', {
				hasMcpParams: stateParts.length > 1,
			});
			if (!creatioState) {
				log.error('oauth.callback.no_creatio_state');
				res.status(400).send('Invalid state format');
				return;
			}
			const stateResult = this._sessionContext.validateAndConsumeOAuthState(creatioState);
			if (!stateResult) {
				log.error('oauth.callback.creatio_state_invalid');
				res.status(400).send('Unknown or expired state');
				return;
			}
			const { userKey, sessionId: boundSessionId } = stateResult;
			const provider = this._server.authProvider;
			if (!supportsInteractiveAuth(provider)) {
				res.status(400).send('Authorization-code flow is not enabled for this deployment');
				return;
			}
			await runWithContext({ userKey }, async () => provider.finishAuthorization(code));
			// Map ONLY the session that initiated this flow, if it still exists.
			// Bearer-token MCP clients carry their identity in the issued JWT and need
			// no session mapping at all.
			if (boundSessionId && this._sessionContext.hasSession(boundSessionId)) {
				this._sessionContext.mapSessionToUser(boundSessionId, userKey);
			}
			const stateParams = new URLSearchParams(state);
			const clientId = stateParams.get('client_id');
			const redirectUri = stateParams.get('redirect_uri');
			const codeChallenge = stateParams.get('code_challenge');
			if (clientId && redirectUri && codeChallenge) {
				// Re-validate the redirect target before emitting any redirect: the MCP params
				// are appended to the state in plaintext and must not be trusted blindly (CWE-601).
				if (!OAuthValidators.isAllowedRedirectUri(redirectUri)) {
					log.error('oauth.callback.redirect_uri_disallowed', { clientId });
					res.status(400).send('Disallowed redirect_uri');
					return;
				}
				const mcpState = stateParams.get('mcp_state');
				log.info('oauth.callback.state_validation', {
					clientId,
					hasState: !!mcpState,
				});
				if (mcpState && !this._oauthServer.validateState(mcpState, clientId)) {
					log.error('oauth.callback.state_invalid', { clientId });
					const errorUrl = new URL(redirectUri);
					errorUrl.searchParams.set('error', 'invalid_request');
					errorUrl.searchParams.set('error_description', 'Unknown or expired state');
					if (mcpState) {
						errorUrl.searchParams.set('state', mcpState);
					}
					return res.redirect(errorUrl.toString());
				}
				const authCode = this._oauthServer.generateAuthorizationCode(
					clientId,
					redirectUri,
					codeChallenge,
					stateParams.get('code_challenge_method') || 'S256',
					userKey,
				);
				const redirectUrl = new URL(redirectUri);
				redirectUrl.searchParams.set('code', authCode);
				if (mcpState) {
					redirectUrl.searchParams.set('state', mcpState);
				}
				return res.redirect(redirectUrl.toString());
			}
			res.status(200).send('Authorization successful. You can close this window.');
		} catch (err: any) {
			log.error('oauth.callback.error', { error: String(err?.message ?? err) });
			res.status(500).send('OAuth callback failed');
		}
	}

	public async handleOAuthRevoke(req: Request, res: Response): Promise<void> {
		try {
			// Identity comes ONLY from the validated Bearer token (set by bearerAuth middleware).
			// A caller must never be able to revoke another user's tokens via ?userKey= (CWE-639).
			const userKey = (req as any).userKey as string | undefined;
			if (!userKey) {
				res.status(401).send('Valid Bearer token required');
				return;
			}
			const provider = this._server.authProvider;
			if (!supportsRevoke(provider)) {
				res.status(400).send('Token revocation is not supported for this deployment');
				return;
			}
			await runWithContext({ userKey }, async () => provider.revoke());
			res.status(200).send('Revoked');
		} catch (err: any) {
			log.error('oauth.revoke.error', { error: String(err?.message ?? err) });
			res.status(500).send('OAuth revoke failed');
		}
	}
}
