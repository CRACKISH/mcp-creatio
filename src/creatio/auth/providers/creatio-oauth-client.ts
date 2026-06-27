import log from '../../../log';
import { UserTokens } from '../../../sessions';
import { BrokerAuthConfig } from '../../client-config';
import {
	AUTHORIZE_ENDPOINT,
	EXPIRES_MARGIN_SECONDS,
	PKCE_S256,
	TOKEN_ENDPOINT,
	resolveIdentityBase,
} from '../auth';

const DEFAULT_TOKEN_LIFETIME_SECONDS = 180;

/**
 * Thin client for the Creatio Identity authorization-code endpoints — the "Creatio leg" of the
 * broker. One place owns every call to Creatio's `/connect/authorize` and `/connect/token` (build
 * the consent URL, exchange a code, refresh), so the broker handler and the runtime provider never
 * duplicate token-endpoint logic (DRY). It is stateless: callers own where tokens are stored.
 */
export class CreatioOAuthClient {
	private readonly _baseUrl: string;
	private readonly _auth: BrokerAuthConfig;

	constructor(baseUrl: string, auth: BrokerAuthConfig) {
		this._baseUrl = baseUrl;
		this._auth = auth;
	}

	private get _identityBase(): string {
		return resolveIdentityBase(this._baseUrl, this._auth.idBaseUrl);
	}

	private get _scope(): string {
		return this._auth.scope || 'offline_access';
	}

	/** Builds the Creatio consent URL for the brokered login (always with S256 PKCE). */
	public buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
		const url = new URL(this._identityBase + AUTHORIZE_ENDPOINT);
		url.searchParams.set('client_id', this._auth.clientId);
		url.searchParams.set('redirect_uri', redirectUri);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('state', state);
		url.searchParams.set('code_challenge', codeChallenge);
		url.searchParams.set('code_challenge_method', PKCE_S256);
		url.searchParams.set('scope', this._scope);
		return url.toString();
	}

	/** Exchanges a Creatio authorization code (+ our PKCE verifier) for the user's Creatio tokens. */
	public async exchangeCode(
		code: string,
		redirectUri: string,
		codeVerifier: string,
	): Promise<UserTokens> {
		const body = this._baseBody();
		body.set('grant_type', 'authorization_code');
		body.set('code', code);
		body.set('redirect_uri', redirectUri);
		body.set('code_verifier', codeVerifier);
		return this._postToken(body, 'exchange');
	}

	/** Refreshes the user's Creatio tokens using a stored refresh token. */
	public async refresh(refreshToken: string): Promise<UserTokens> {
		const body = this._baseBody();
		body.set('grant_type', 'refresh_token');
		body.set('refresh_token', refreshToken);
		body.set('scope', this._scope);
		const tokens = await this._postToken(body, 'refresh');
		// Rotating refresh tokens: keep the previous one if Creatio did not return a new one.
		return tokens.refreshToken ? tokens : { ...tokens, refreshToken };
	}

	private _baseBody(): URLSearchParams {
		const body = new URLSearchParams();
		body.set('client_id', this._auth.clientId);
		// Confidential clients send a secret; public clients (PKCE) send none.
		if (this._auth.clientSecret) {
			body.set('client_secret', this._auth.clientSecret);
		}
		return body;
	}

	private async _postToken(
		body: URLSearchParams,
		op: 'exchange' | 'refresh',
	): Promise<UserTokens> {
		const url = this._identityBase + TOKEN_ENDPOINT;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
		const text = await res.text().catch(() => '');
		if (!res.ok || !text) {
			log.error(`broker.creatio.${op}_failed`, {
				status: res.status,
				body: text.slice(0, 200),
			});
			throw new Error(`creatio_oauth_${op}_error:${res.status}`);
		}
		let json: { access_token?: string; refresh_token?: string; expires_in?: number };
		try {
			json = JSON.parse(text);
		} catch {
			throw new Error(`creatio_oauth_${op}_parse_failed`);
		}
		if (!json.access_token) {
			throw new Error(`creatio_oauth_${op}_no_access_token`);
		}
		const lifetime = Number(json.expires_in) || DEFAULT_TOKEN_LIFETIME_SECONDS;
		return {
			accessToken: String(json.access_token),
			accessTokenExpiryMs: Date.now() + Math.max(1, lifetime - EXPIRES_MARGIN_SECONDS) * 1000,
			...(json.refresh_token ? { refreshToken: String(json.refresh_token) } : {}),
		};
	}
}
