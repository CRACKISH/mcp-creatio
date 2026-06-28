import crypto from 'crypto';

import jwt from 'jsonwebtoken';

import log from '../../log';

import type { AuthorizationCodeData } from './storage';
import type { OAuthError, OAuthTokenRequest } from './types';

/**
 * Issuer + audience an access token is bound to: this MCP deployment's own origin (`iss`) and its
 * `/mcp` resource (`aud`). Binding both closes token-redirection / confused-deputy — a token minted
 * for deployment A is rejected by deployment B even when both share `CREATIO_MCP_JWT_SECRET`
 * (the documented multi-instance setup). Mirrors RFC 9068 (`aud`) / RFC 8707 (resource indicators).
 */
export interface TokenAudience {
	issuer: string;
	audience: string;
}

/** The claims we trust off a verified access token. */
export interface DecodedAccessToken {
	userKey: string;
	client_id: string;
}

export class OAuthTokenManager {
	private readonly _jwtSecret: string;

	constructor(jwtSecret: string) {
		this._jwtSecret = jwtSecret;
	}

	/** Mint a 1h access token bound to `userKey` (as `sub`), the issuing `client_id`, and the
	 *  deployment's `iss`/`aud`. */
	public generateAccessToken(userKey: string, client_id: string, aud: TokenAudience): string {
		return jwt.sign({ client_id }, this._jwtSecret, {
			subject: userKey,
			expiresIn: '1h',
			issuer: aud.issuer,
			audience: aud.audience,
		});
	}

	public generateRefreshToken(): string {
		return crypto.randomBytes(32).toString('base64url');
	}

	/** Verify signature AND issuer/audience binding; return the trusted claims or `null`. */
	public validateAccessToken(token: string, aud: TokenAudience): DecodedAccessToken | null {
		try {
			const decoded = jwt.verify(token, this._jwtSecret, {
				issuer: aud.issuer,
				audience: aud.audience,
			}) as jwt.JwtPayload;
			const userKey = typeof decoded.sub === 'string' ? decoded.sub : null;
			const client_id = typeof decoded.client_id === 'string' ? decoded.client_id : '';
			return userKey ? { userKey, client_id } : null;
		} catch (error) {
			log.warn('oauth.token.invalid', { error: String(error) });
			return null;
		}
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
