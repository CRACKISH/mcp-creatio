import crypto from 'crypto';

import log from '../../log';

import { OAuthClientManager } from './client-manager';
import { OAuthStorage } from './storage';
import { OAuthTokenManager } from './token-manager';
import { OAuthValidators } from './validators';

import type {
	OAuthAccessToken,
	OAuthAuthorizationRequest,
	OAuthAuthorizationServerMetadata,
	OAuthClient,
	OAuthError,
	OAuthTokenRequest,
} from './types';

export class OAuthServer {
	private readonly _jwtSecret: string = crypto.randomBytes(32).toString('hex');
	private readonly _storage = new OAuthStorage();
	private readonly _tokenManager: OAuthTokenManager;
	private readonly _accessTokens = new Map<string, OAuthAccessToken>();

	constructor(private _baseUrl: string = 'http://localhost:3000') {
		this._tokenManager = new OAuthTokenManager(this._jwtSecret);
	}

	private _autoRegisterClientIfNeeded(client_id: string, redirect_uri: string): boolean {
		if (this._storage.hasClient(client_id)) {
			return false;
		}
		const client = OAuthClientManager.autoRegisterClient(client_id, redirect_uri);
		this._storage.addClient(client);
		return true;
	}

	public getAuthorizationServerMetadata(): OAuthAuthorizationServerMetadata {
		return {
			issuer: this._baseUrl,
			authorization_endpoint: `${this._baseUrl}/authorize`,
			token_endpoint: `${this._baseUrl}/token`,
			registration_endpoint: `${this._baseUrl}/register`,
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code'],
			token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
			code_challenge_methods_supported: ['S256'],
			scopes_supported: ['openid'],
		};
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

	public storeState(state: string, client_id: string): void {
		this._storage.storeState(state, client_id);
		log.info('oauth.state.stored', { state, client_id });
	}

	public validateState(state: string, client_id: string): boolean {
		log.info('oauth.state.validate_attempt', {
			state,
			client_id,
			storedStates: this._storage.getAllStates(),
		});
		const stateData = this._storage.getState(state);
		if (!stateData) {
			log.warn('oauth.state.not_found', {
				state,
				storedStates: this._storage.getAllStates(),
			});
			return false;
		}
		if (stateData.expires_at < Date.now()) {
			this._storage.deleteState(state);
			log.warn('oauth.state.expired', { state });
			return false;
		}
		if (stateData.client_id !== client_id) {
			log.warn('oauth.state.client_mismatch', {
				state,
				expected: stateData.client_id,
				actual: client_id,
			});
			return false;
		}
		this._storage.deleteState(state);
		log.info('oauth.state.validated_successfully', { state, client_id });
		return true;
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
			code: params.code ? '***' + params.code.slice(-4) : 'missing',
			client_id: params.client_id,
			redirect_uri: params.redirect_uri,
			has_code_verifier: !!params.code_verifier,
			stored_codes: this._storage.getAllStoredCodes().map((k) => '***' + k.slice(-4)),
		});
		const validationError = OAuthValidators.validateTokenRequest(params);
		if (validationError) {
			return validationError;
		}
		const authCode = this._storage.getAuthorizationCode(params.code!);
		if (!authCode) {
			log.error('oauth.token.code_not_found', {
				code: '***' + params.code!.slice(-4),
				stored_codes: this._storage.getAllStoredCodes().map((k) => '***' + k.slice(-4)),
			});
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
		this._accessTokens.set(tokenResponse.access_token, tokenResponse);
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
