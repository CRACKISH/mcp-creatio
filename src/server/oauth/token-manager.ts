import crypto from 'crypto';

import jwt from 'jsonwebtoken';

import log from '../../log';

import type { AuthorizationCodeData } from './storage';
import type { OAuthAccessToken, OAuthError, OAuthTokenRequest } from './types';

export class OAuthTokenManager {
	constructor(private readonly _jwtSecret: string) {}

	public generateAccessToken(userKey: string, client_id: string): string {
		return jwt.sign({ userKey, client_id }, this._jwtSecret, { expiresIn: '1h' });
	}

	public generateRefreshToken(): string {
		return crypto.randomBytes(32).toString('base64url');
	}

	public validateAccessToken(token: string): string | null {
		try {
			const decoded = jwt.verify(token, this._jwtSecret) as any;
			return decoded.userKey || null;
		} catch (error) {
			log.warn('oauth.token.invalid', { error: String(error) });
			return null;
		}
	}

	public createTokenResponse(
		userKey: string,
		client_id: string,
		refresh_token_required: boolean = true,
	): OAuthAccessToken {
		const access_token = this.generateAccessToken(userKey, client_id);
		const expires_in = 3600;
		const tokenResponse: OAuthAccessToken = {
			access_token,
			token_type: 'Bearer',
			expires_in,
			userKey,
		};
		if (refresh_token_required) {
			tokenResponse.refresh_token = this.generateRefreshToken();
		}
		return tokenResponse;
	}

	public verifyPKCE(code_verifier: string, code_challenge: string): boolean {
		const hash = crypto.createHash('sha256').update(code_verifier).digest('base64url');
		return hash === code_challenge;
	}

	public validateAuthCodeData(
		authCode: AuthorizationCodeData,
		params: OAuthTokenRequest,
	): OAuthError | null {
		if (Date.now() > authCode.expires_at) {
			return { error: 'invalid_grant', error_description: 'Authorization code expired' };
		}
		if (authCode.client_id !== params.client_id) {
			return { error: 'invalid_grant', error_description: 'Client mismatch' };
		}
		if (authCode.redirect_uri !== params.redirect_uri) {
			return { error: 'invalid_grant', error_description: 'Redirect URI mismatch' };
		}
		if (!params.code_verifier) {
			return { error: 'invalid_request', error_description: 'Missing code_verifier' };
		}
		if (!this.verifyPKCE(params.code_verifier, authCode.code_challenge)) {
			return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
		}
		return null;
	}
}
