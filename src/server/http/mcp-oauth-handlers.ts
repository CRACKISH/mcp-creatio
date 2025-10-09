import { randomUUID } from 'node:crypto';

import log from '../../log';
import { OAuthValidators } from '../oauth/validators';

import type { OAuthServer } from '../oauth';
import type { Request, Response } from 'express';

export class MCPOAuthHandlers {
	constructor(private readonly _oauthServer: OAuthServer) {}

	public handleMetadata(req: Request, res: Response): void {
		const metadata = this._oauthServer.getAuthorizationServerMetadata();
		res.json(metadata);
	}

	public handleClientRegistration(req: Request, res: Response): Response | void {
		try {
			const { redirect_uris } = req.body;
			const validationError = OAuthValidators.validateClientRegistration(redirect_uris);
			if (validationError) {
				return res.status(400).json({
					error: 'invalid_request',
					error_description: validationError,
				});
			}
			const client = this._oauthServer.registerClient(redirect_uris);
			res.status(201).json(client);
		} catch (error) {
			log.error('oauth.register.error', { error: String(error) });
			res.status(500).json({
				error: 'server_error',
				error_description: 'Failed to register client',
			});
		}
	}

	public async handleAuthorization(req: Request, res: Response): Promise<void> {
		try {
			const params = {
				client_id: req.query.client_id as string,
				redirect_uri: req.query.redirect_uri as string,
				response_type: req.query.response_type as string,
				state: req.query.state as string,
				code_challenge: req.query.code_challenge as string,
				code_challenge_method: req.query.code_challenge_method as string,
				scope: req.query.scope as string,
			};
			const validationError = this._oauthServer.validateAuthorizationRequest(params);
			if (validationError) {
				const errorUrl = new URL(params.redirect_uri);
				errorUrl.searchParams.set('error', validationError.error);
				if (validationError.error_description) {
					errorUrl.searchParams.set(
						'error_description',
						validationError.error_description,
					);
				}
				if (params.state) {
					errorUrl.searchParams.set('state', params.state);
				}
				return res.redirect(errorUrl.toString());
			}
			if (params.state) {
				this._oauthServer.storeState(params.state, params.client_id);
			}
			const authKey = randomUUID();
			const creatioAuthUrl = `/oauth/start?authKey=${authKey}&client_id=${params.client_id}&redirect_uri=${encodeURIComponent(params.redirect_uri)}&code_challenge=${params.code_challenge}&code_challenge_method=${params.code_challenge_method}&state=${params.state || ''}`;
			res.redirect(creatioAuthUrl);
		} catch (error) {
			log.error('oauth.authorize.error', { error: String(error) });
			res.status(500).send('Authorization failed');
		}
	}

	public async handleTokenExchange(req: Request, res: Response): Promise<Response | void> {
		try {
			const tokenParams = req.body || {};
			log.info('oauth.token.request', {
				contentType: req.headers['content-type'],
				hasBody: !!req.body,
				bodyKeys: req.body ? Object.keys(req.body) : [],
				params: {
					grant_type: tokenParams.grant_type,
					code: tokenParams.code ? '***' + tokenParams.code.slice(-4) : 'missing',
					client_id: tokenParams.client_id,
					redirect_uri: tokenParams.redirect_uri,
					has_code_verifier: !!tokenParams.code_verifier,
				},
			});
			const result = await this._oauthServer.exchangeCodeForToken(tokenParams);
			if ('error' in result) {
				return res.status(400).json(result);
			}
			res.json(result);
		} catch (error) {
			log.error('oauth.token.error', { error: String(error) });
			res.status(500).json({
				error: 'server_error',
				error_description: 'Failed to exchange token',
			});
		}
	}
}
