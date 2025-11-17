import { HTTP_MCP_PORT } from '../../../consts';
import log from '../../../log';
import { SessionContext, TokenRefreshScheduler, type UserTokens } from '../../../services';
import { getEffectiveUserKey, getUserKey } from '../../../utils';
import { CreatioClientConfig, OAuth2CodeAuthConfig } from '../../client-config';
import { AUTHORIZE_ENDPOINT, REVOCATION_ENDPOINT, TOKEN_ENDPOINT } from '../auth';

import { BaseOAuth2Provider } from './base-oauth2-provider';

export class OAuth2CodeProvider extends BaseOAuth2Provider<OAuth2CodeAuthConfig> {
	private readonly _sessionContext = SessionContext.instance;
	private readonly _tokenRefreshScheduler = new TokenRefreshScheduler();

	protected readonly authErrorCode = 'oauth2_code_need_consent';

	private get _scope() {
		return this.authConfig.scope || 'offline_access';
	}

	constructor(config: CreatioClientConfig) {
		super(config);
		this._tokenRefreshScheduler.setRefreshCallback(this.refreshUserTokens.bind(this));
	}

	private async _exchangeCodeForTokens(code: string): Promise<UserTokens> {
		const idBase = this.getIdentityBase();
		const url = idBase + TOKEN_ENDPOINT;
		const body = new URLSearchParams();
		body.set('grant_type', 'authorization_code');
		body.set('client_id', this.authConfig.clientId);
		if (this.authConfig.clientSecret) {
			body.set('client_secret', this.authConfig.clientSecret);
		}
		body.set('code', code);
		body.set('redirect_uri', this.authConfig.redirectUri);
		body.set('scope', this._scope);
		log.creatioAuthStart(this.config.baseUrl, 'oauth2_code');
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
		const txt = await res.text().catch(() => '');
		if (!res.ok || !txt) {
			log.creatioAuthFailed(this.config.baseUrl, `token:${res.status} ${txt}`, 'oauth2_code');
			throw new Error(`oauth2_code_token_error:${res.status}`);
		}
		let j: any;
		try {
			j = JSON.parse(txt);
		} catch {
			log.creatioAuthFailed(this.config.baseUrl, 'token_parse_failed', 'oauth2_code');
			throw new Error('oauth2_code_token_parse_failed');
		}
		if (!j.access_token) {
			throw new Error('oauth2_code_no_access_token');
		}
		const expiresIn = Number(j.expires_in) || 180;
		const accessTokenExpiryMs = this.computeExpiryMs(expiresIn, 1);
		log.creatioAuthOk(this.config.baseUrl, 'oauth2_code');
		return {
			accessToken: String(j.access_token),
			accessTokenExpiryMs,
			refreshToken: j.refresh_token ? String(j.refresh_token) : undefined,
		};
	}

	private async _refreshTokens(refreshToken: string): Promise<UserTokens> {
		const idBase = this.getIdentityBase();
		const url = idBase + TOKEN_ENDPOINT;
		log.info('oauth2_code.refresh_attempt', { url, refreshTokenLength: refreshToken.length });
		const body = new URLSearchParams();
		body.set('grant_type', 'refresh_token');
		body.set('client_id', this.authConfig.clientId);
		if (this.authConfig.clientSecret) {
			body.set('client_secret', this.authConfig.clientSecret);
		}
		body.set('refresh_token', refreshToken);
		body.set('redirect_uri', this.authConfig.redirectUri);
		body.set('scope', this._scope);
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		});
		const txt = await res.text().catch(() => '');
		log.info('oauth2_code.refresh_response', {
			status: res.status,
			hasBody: !!txt,
			bodyLength: txt.length,
		});
		if (!res.ok || !txt) {
			log.error('oauth2_code.refresh_failed', {
				status: res.status,
				body: txt.substring(0, 200),
			});
			throw new Error(`oauth2_code_refresh_error:${res.status}`);
		}
		let j: any;
		try {
			j = JSON.parse(txt);
		} catch {
			throw new Error('oauth2_code_refresh_parse_failed');
		}
		if (!j.access_token) {
			throw new Error('oauth2_code_refresh_no_access_token');
		}
		const expiresIn = Number(j.expires_in) || 180;
		const accessTokenExpiryMs = this.computeExpiryMs(expiresIn, 1);
		const newTokens = {
			accessToken: String(j.access_token),
			accessTokenExpiryMs,
			refreshToken: j.refresh_token ? String(j.refresh_token) : refreshToken,
		};
		log.info('oauth2_code.refresh_success', {
			hasNewRefreshToken: !!j.refresh_token,
			expiresIn,
			accessTokenLength: newTokens.accessToken.length,
		});
		return newTokens;
	}

	protected throwNoTokenError(): void {
		const userKey = getEffectiveUserKey();
		const errorMessage = userKey
			? `${this.authErrorCode}:http://localhost:${HTTP_MCP_PORT}/oauth/start?userKey=${encodeURIComponent(userKey)}`
			: this.authErrorCode;
		throw new Error(errorMessage);
	}

	protected async ensureAccessToken(force = false): Promise<string | undefined> {
		log.info('oauth2_code.ensure_access_token.start', { force });
		const now = Date.now();
		if (
			!force &&
			this.accessToken &&
			this.accessTokenExpiryMs &&
			now < this.accessTokenExpiryMs
		) {
			return this.accessToken;
		}
		const userKey = getEffectiveUserKey();
		if (!userKey) {
			log.warn('oauth2_code.no_user_key');
			return undefined;
		}
		const saved = await this._sessionContext.getTokensForUser(userKey);
		if (!saved) {
			log.warn('oauth2_code.no_saved_tokens', { userKey });
			return undefined;
		}
		if (
			!force &&
			saved.accessToken &&
			saved.accessTokenExpiryMs &&
			now < saved.accessTokenExpiryMs
		) {
			this.accessToken = saved.accessToken;
			this.accessTokenExpiryMs = saved.accessTokenExpiryMs;
			return this.accessToken;
		}
		if (saved.refreshToken) {
			const updated = await this._refreshTokens(saved.refreshToken);
			await this._sessionContext.setTokensForUser(userKey, updated);
			this.accessToken = updated.accessToken;
			this.accessTokenExpiryMs = updated.accessTokenExpiryMs;
			return this.accessToken;
		}
		await this._sessionContext.deleteTokensForUser(userKey);
		return undefined;
	}

	public async finishAuthorization(code: string): Promise<void> {
		const userKey = getEffectiveUserKey();
		log.info('oauth2_code.finish_authorization', { userKey, hasCode: !!code });
		if (!userKey) {
			throw new Error('oauth2_code_missing_user');
		}
		const tokens = await this._exchangeCodeForTokens(code);
		await this._sessionContext.setTokensForUser(userKey, tokens);
		this.accessToken = tokens.accessToken;
		this.accessTokenExpiryMs = tokens.accessTokenExpiryMs;
		this._tokenRefreshScheduler.scheduleRefresh(userKey);
		log.info('oauth2_code.authorization_complete', { userKey });
	}

	public async getAuthorizeUrl(state: string): Promise<string> {
		const idBase = this.getIdentityBase();
		const u = new URL(idBase + AUTHORIZE_ENDPOINT);
		u.searchParams.set('client_id', this.authConfig.clientId);
		u.searchParams.set('redirect_uri', this.authConfig.redirectUri);
		u.searchParams.set('response_type', 'code');
		u.searchParams.set('state', state);
		const scopeParam = encodeURIComponent(this._scope);
		u.search += '&scope=' + scopeParam;
		log.info('oauth2_code.authorize_url', {
			idBase,
			url: u.toString(),
		});
		return u.toString();
	}

	public async revoke(): Promise<void> {
		try {
			const userKey = getUserKey();
			if (!userKey) {
				return;
			}
			const saved = await this._sessionContext.getTokensForUser(userKey);
			if (!saved?.refreshToken) {
				await this._sessionContext.deleteTokensForUser(userKey);
				return;
			}
			const idBase = this.getIdentityBase();
			const url = idBase + REVOCATION_ENDPOINT;
			const body = new URLSearchParams();
			body.set('client_id', this.authConfig.clientId);
			if (this.authConfig.clientSecret) {
				body.set('client_secret', this.authConfig.clientSecret);
			}
			body.set('token', saved.refreshToken);
			body.set('token_type_hint', 'refresh_token');
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			});
			if (!res.ok) {
				const t = await res.text().catch(() => '');
				log.error('oauth2_code.revoke_failed', { status: res.status, t });
			}
		} finally {
			const userKey = getUserKey();
			if (userKey) {
				await this._sessionContext.deleteTokensForUser(userKey);
				this._tokenRefreshScheduler.cancelRefresh(userKey);
			}
			this.accessToken = undefined;
			this.accessTokenExpiryMs = undefined;
		}
	}

	public async refreshUserTokens(userKey: string): Promise<void> {
		const saved = await this._sessionContext.getTokensForUser(userKey);
		if (!saved?.refreshToken) {
			throw new Error('oauth2_no_refresh_token');
		}
		const updated = await this._refreshTokens(saved.refreshToken);
		await this._sessionContext.setTokensForUser(userKey, updated);
		log.info('oauth2_code.background_refresh_success', { userKey });
	}
}
