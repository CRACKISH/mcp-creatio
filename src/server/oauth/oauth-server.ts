import crypto from 'crypto';

import log from '../../log';

import { OAuthClientManager } from './client-manager';
import { OAuthStorage } from './storage';
import { OAuthTokenManager } from './token-manager';
import { OAuthValidators } from './validators';

import type {
	OAuthAccessToken,
	OAuthAuthorizationRequest,
	OAuthClient,
	OAuthError,
	OAuthTokenRequest,
} from './types';

export class OAuthServer {
	private readonly _storage = new OAuthStorage();
	private readonly _tokenManager: OAuthTokenManager;

	/**
	 * @param jwtSecret stable secret (from `CREATIO_MCP_JWT_SECRET`) signing the tokens issued to
	 *        MCP clients — stable so issued tokens survive a restart, unlike a random per-process key.
	 */
	constructor(jwtSecret: string) {
		this._tokenManager = new OAuthTokenManager(jwtSecret);
	}

	/**
	 * Records a brokered authorization in flight and returns its opaque broker state (used as the
	 * `state` on the Creatio leg). Server-side storage keeps the client's PKCE and our Creatio-leg
	 * verifier apart — nothing is embedded in the Creatio `state`.
	 */
	public createPendingAuthorization(data: {
		client_id: string;
		redirect_uri: string;
		code_challenge: string;
		code_challenge_method: string;
		client_state?: string | undefined;
		creatio_verifier: string;
	}): string {
		const brokerState = crypto.randomBytes(32).toString('base64url');
		this._storage.storePendingAuthorization(brokerState, data);
		return brokerState;
	}

	public takePendingAuthorization(brokerState: string) {
		return this._storage.takePendingAuthorization(brokerState);
	}

	private _autoRegisterClientIfNeeded(client_id: string, redirect_uri: string): boolean {
		if (this._storage.hasClient(client_id)) {
			return false;
		}
		// Never auto-register a client bound to a redirect target we would not allow,
		// otherwise validateAuthorizationRequest would "pass" against an attacker URI (CWE-601).
		if (!OAuthValidators.isAllowedRedirectUri(redirect_uri)) {
			log.warn('oauth.client.auto_register_rejected', { client_id });
			return false;
		}
		const client = OAuthClientManager.autoRegisterClient(client_id, redirect_uri);
		this._storage.addClient(client);
		return true;
	}

	public registerClient(redirect_uris: string[]): OAuthClient {
		const client = OAuthClientManager.createClient(redirect_uris);
		this._storage.addClient(client);
		return client;
	}

	public validateAuthorizationRequest(params: OAuthAuthorizationRequest): OAuthError | null {
		let client = this._storage.getClient(params.client_id);
		if (!client) {
			const wasRegistered = this._autoRegisterClientIfNeeded(
				params.client_id,
				params.redirect_uri,
			);
			if (wasRegistered) {
				client = this._storage.getClient(params.client_id);
			}
		}
		return OAuthValidators.validateAuthorizationRequest(params, client);
	}

	public generateAuthorizationCode(
		client_id: string,
		redirect_uri: string,
		code_challenge: string,
		code_challenge_method: string,
		userKey: string,
	): string {
		const code = crypto.randomBytes(32).toString('base64url');
		this._storage.storeAuthorizationCode(
			code,
			client_id,
			redirect_uri,
			code_challenge,
			code_challenge_method,
			userKey,
		);
		log.info('oauth.authorization_code.generated', { client_id, userKey });
		return code;
	}

	public async exchangeCodeForToken(
		params: OAuthTokenRequest,
	): Promise<OAuthAccessToken | OAuthError> {
		log.info('oauth.token.exchange_start', {
			grant_type: params.grant_type,
			client_id: params.client_id,
			redirect_uri: params.redirect_uri,
			has_code_verifier: !!params.code_verifier,
		});
		const validationError = OAuthValidators.validateTokenRequest(params);
		if (validationError) {
			return validationError;
		}
		const authCode = this._storage.getAuthorizationCode(params.code!);
		if (!authCode) {
			log.error('oauth.token.code_not_found', { client_id: params.client_id });
			return { error: 'invalid_grant', error_description: 'Invalid authorization code' };
		}
		const codeValidationError = this._tokenManager.validateAuthCodeData(authCode, params);
		if (codeValidationError) {
			if (
				codeValidationError.error === 'invalid_grant' &&
				codeValidationError.error_description === 'Authorization code expired'
			) {
				this._storage.deleteAuthorizationCode(params.code!);
			}
			return codeValidationError;
		}
		const tokenResponse = this._tokenManager.createTokenResponse(
			authCode.userKey,
			params.client_id,
		);
		this._storage.deleteAuthorizationCode(params.code!);
		log.info('oauth.token.issued', { client_id: params.client_id, userKey: authCode.userKey });
		return tokenResponse;
	}

	public validateAccessToken(token: string): string | null {
		return this._tokenManager.validateAccessToken(token);
	}

	public getClient(client_id: string): OAuthClient | undefined {
		return this._storage.getClient(client_id);
	}

	public cleanup(): void {
		this._storage.cleanup();
	}
}
