import crypto from 'crypto';

import log from '../../log';

import { OAuthClientManager } from './client-manager';
import { OAuthStorage } from './storage';
import { OAuthTokenManager, TokenAudience } from './token-manager';
import { OAuthValidators } from './validators';

import type {
	OAuthAccessToken,
	OAuthAuthorizationRequest,
	OAuthClient,
	OAuthError,
	OAuthTokenRequest,
} from './types';

/** Predicate the broker supplies so a refresh is rejected once it no longer holds the user's
 *  Creatio tokens (a restart) — the client then transparently re-runs the full flow. */
type SessionStillHeld = (userKey: string) => Promise<boolean>;

const ACCESS_TOKEN_TTL_SECONDS = 3600;
const ISSUED_SCOPE = 'offline_access';

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

	/** Mint an access token + a freshly-stored (rotating) refresh token as a standard OAuth response. */
	private _issueTokens(userKey: string, client_id: string, aud: TokenAudience): OAuthAccessToken {
		const access_token = this._tokenManager.generateAccessToken(userKey, client_id, aud);
		const refresh_token = this._tokenManager.generateRefreshToken();
		this._storage.storeRefreshToken(refresh_token, userKey, client_id);
		return {
			access_token,
			token_type: 'Bearer',
			expires_in: ACCESS_TOKEN_TTL_SECONDS,
			refresh_token,
			scope: ISSUED_SCOPE,
		};
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
		aud: TokenAudience,
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
		this._storage.deleteAuthorizationCode(params.code!);
		log.info('oauth.token.issued', { client_id: params.client_id, userKey: authCode.userKey });
		return this._issueTokens(authCode.userKey, params.client_id, aud);
	}

	/**
	 * `refresh_token` grant: rotate the refresh token and mint a fresh access token WITHOUT a browser
	 * round-trip — bound to the same client (a stolen token can't be redeemed by another) and gated on
	 * the broker still holding this user's Creatio tokens, so a client never re-consents every hour.
	 */
	public async exchangeRefreshToken(
		params: OAuthTokenRequest,
		aud: TokenAudience,
		sessionStillHeld: SessionStillHeld,
	): Promise<OAuthAccessToken | OAuthError> {
		const validationError = OAuthValidators.validateTokenRequest(params);
		if (validationError) {
			return validationError;
		}
		const data = this._storage.getRefreshToken(params.refresh_token!);
		if (!data) {
			return {
				error: 'invalid_grant',
				error_description: 'Invalid or expired refresh token',
			};
		}
		if (data.client_id !== params.client_id) {
			// Token presented by a different client than it was issued to — reuse/theft signal.
			this._storage.deleteRefreshToken(params.refresh_token!);
			return { error: 'invalid_grant', error_description: 'Client mismatch' };
		}
		if (!(await sessionStillHeld(data.userKey))) {
			this._storage.deleteRefreshToken(params.refresh_token!);
			return {
				error: 'invalid_grant',
				error_description: 'Session expired; re-authorization required',
			};
		}
		// Rotate: the presented refresh token is single-use.
		this._storage.deleteRefreshToken(params.refresh_token!);
		log.info('oauth.token.refreshed', { client_id: data.client_id, userKey: data.userKey });
		return this._issueTokens(data.userKey, data.client_id, aud);
	}

	/** Verify a client-presented access token against this deployment's `iss`/`aud`; returns userKey. */
	public validateAccessToken(token: string, aud: TokenAudience): string | null {
		return this._tokenManager.validateAccessToken(token, aud)?.userKey ?? null;
	}

	public cleanup(): void {
		this._storage.cleanup();
	}
}
