import log from '../../log';
import { SessionContext } from '../../services';
import { runWithContext } from '../../utils';

import type { Server } from '../mcp';
import type { OAuthServer } from '../oauth';
import type { Request, Response } from 'express';

export class CreatioOAuthHandlers {
	private readonly _sessionContext = SessionContext.instance;

	constructor(
		private readonly _server: Server,
		private readonly _oauthServer: OAuthServer,
	) {}

	private _mapAllSessionsToUser(userKey: string): void {
		const sessions = this._sessionContext.getAllSessions();
		const sessionIds = sessions.map((s) => s.id);
		log.info('mapping_all_sessions', { userKey, sessionCount: sessionIds.length, sessionIds });
		for (const sessionId of sessionIds) {
			this._sessionContext.setSessionUserKey(sessionId, userKey);
		}
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
			const state = this._sessionContext.createOAuthState(effectiveUserKey);
			const url = await this._server.authProvider.getAuthorizeUrl(state);
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
				code: code ? '***' + code.slice(-4) : 'missing',
				state: state ? state.substring(0, 50) + '...' : 'missing',
				fullState: state,
			});
			if (!code || !state) {
				res.status(400).send('Missing code or state');
				return;
			}
			const stateParts = state.split('&');
			const creatioState = stateParts[0];
			log.info('oauth.callback.state_parse', {
				originalState: state,
				creatioState,
				hasMcpParams: stateParts.length > 1,
			});
			if (!creatioState) {
				log.error('oauth.callback.no_creatio_state', { originalState: state });
				res.status(400).send('Invalid state format');
				return;
			}
			const userKey = this._sessionContext.validateAndConsumeOAuthState(creatioState);
			if (!userKey) {
				log.error('oauth.callback.creatio_state_invalid', { creatioState });
				res.status(400).send('Unknown or expired state');
				return;
			}
			await runWithContext({ userKey }, async () =>
				this._server.authProvider.finishAuthorization(code),
			);
			this._mapAllSessionsToUser(userKey);
			const stateParams = new URLSearchParams(state);
			const clientId = stateParams.get('client_id');
			const redirectUri = stateParams.get('redirect_uri');
			const codeChallenge = stateParams.get('code_challenge');
			if (clientId && redirectUri && codeChallenge) {
				const mcpState = stateParams.get('mcp_state');
				log.info('oauth.callback.state_validation', {
					mcpState,
					clientId,
					hasState: !!mcpState,
				});
				if (mcpState && !this._oauthServer.validateState(mcpState, clientId)) {
					log.error('oauth.callback.state_invalid', { mcpState, clientId });
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
			const userKey = (req.query.userKey as string) || (req.body?.userKey as string);
			if (!userKey) {
				res.status(400).send('Missing userKey parameter');
				return;
			}
			await runWithContext({ userKey }, async () => this._server.authProvider.revoke());
			res.status(200).send('Revoked');
		} catch (err: any) {
			log.error('oauth.revoke.error', { error: String(err?.message ?? err) });
			res.status(500).send('OAuth revoke failed');
		}
	}
}
