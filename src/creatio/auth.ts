import log from '../log';
import { parseSetCookie } from '../utils';

import { CreatioClientConfig } from './client';

const JSON_ACCEPT = 'application/json;odata.metadata=minimal';
const XML_ACCEPT = 'application/xml';
const TOKEN_ENDPOINT = '/connect/token';
const TOKEN_BODY_SNIPPET_MAX = 1024;
const EXPIRES_MARGIN_SECONDS = 30;

/**
 * Authentication provider interface — single responsibility: provide headers and refresh when needed.
 */
interface IAuthProvider {
	getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;
	refresh(): Promise<void>;
}

function buildHeaders(accept: string, isJson?: boolean, token?: string): Record<string, string> {
	const headers: Record<string, string> = { Accept: accept };
	if (isJson) headers['Content-Type'] = 'application/json';
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return headers;
}

/**
 * OAuth2 provider: handles client_credentials token lifecycle and caching.
 */
class OAuth2Provider implements IAuthProvider {
	private _accessToken: string | undefined;
	private _accessTokenExpiryMs: number | undefined;

	constructor(private readonly _config: CreatioClientConfig) {}

	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		const token = await this._acquireToken();
		if (!token) throw new Error('oauth2_auth_failed');
		return buildHeaders(accept, Boolean(isJson), token);
	}

	public async refresh(): Promise<void> {
		this._accessToken = undefined;
		this._accessTokenExpiryMs = undefined;
		await this._acquireToken();
	}

	private async _acquireToken(): Promise<string | undefined> {
		const now = Date.now();
		if (this._accessToken && this._accessTokenExpiryMs && now < this._accessTokenExpiryMs) {
			return this._accessToken;
		}

		const oauth = this._config.auth as {
			kind: 'oauth2';
			clientId: string;
			clientSecret: string;
			idBaseUrl?: string;
		};
		const identityBaseUrl = oauth.idBaseUrl
			? oauth.idBaseUrl.replace(/\/$/, '')
			: this._config.baseUrl.replace(/\/$/, '');
		const url = `${identityBaseUrl}${TOKEN_ENDPOINT}`;
		const body = new URLSearchParams();
		body.set('grant_type', 'client_credentials');
		body.set('client_id', oauth.clientId);
		body.set('client_secret', oauth.clientSecret);

		try {
			log.creatioAuthStart(this._config.baseUrl, 'oauth2');
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			});
			const responseText = await response.text().catch(() => '');
			const contentType = (response.headers as any)?.get?.('content-type') ?? '';
			const bodySnippet =
				responseText && responseText.length > TOKEN_BODY_SNIPPET_MAX
					? responseText.slice(0, TOKEN_BODY_SNIPPET_MAX) + '\n... [truncated]'
					: responseText;
			if (!response.ok) {
				log.error('oauth.token.error', {
					url,
					status: response.status,
					contentType,
					bodySnippet,
				});
				log.creatioAuthFailed(
					this._config.baseUrl,
					`token_error:${response.status}`,
					'oauth2',
				);
				throw new Error(`oauth2_token_error:${response.status}`);
			}
			if (!responseText) {
				log.error('oauth.token.empty_body', { url, status: response.status, contentType });
				log.creatioAuthFailed(this._config.baseUrl, 'empty_response_body', 'oauth2');
				throw new Error('oauth2_empty_token_response');
			}
			let tokenResponse: any = null;
			try {
				tokenResponse = JSON.parse(responseText);
			} catch (err) {
				log.error('oauth.token.parse_failed', {
					url,
					status: response.status,
					contentType,
					bodySnippet,
				});
				log.creatioAuthFailed(this._config.baseUrl, 'token_parse_failed', 'oauth2');
				throw new Error('oauth2_token_parse_failed');
			}
			if (!tokenResponse || !tokenResponse.access_token) {
				log.creatioAuthFailed(
					this._config.baseUrl,
					'no_access_token_in_response',
					'oauth2',
				);
				throw new Error('oauth2_no_access_token');
			}
			this._accessToken = String(tokenResponse.access_token);
			const expiresIn = Number(tokenResponse.expires_in) || 3600;
			this._accessTokenExpiryMs =
				Date.now() + Math.max(1000, expiresIn - EXPIRES_MARGIN_SECONDS) * 1000;
			log.creatioAuthOk(this._config.baseUrl, 'oauth2');
			return this._accessToken;
		} catch (e: any) {
			log.error('oauth.token.exception', { error: String(e?.message ?? e) });
			log.creatioAuthFailed(this._config.baseUrl, String(e?.message ?? e), 'oauth2');
			return undefined;
		}
	}
}

/**
 * Legacy provider: uses existing session login and cookie handling.
 */
class LegacyProvider implements IAuthProvider {
	private _cookieHeader: string | undefined;
	private _bpmCsrf: string | undefined;

	constructor(private readonly _config: CreatioClientConfig) {}

	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		await this._ensureSession();
		const h = buildHeaders(accept, Boolean(isJson));
		h['ForceUseSession'] = 'true';
		h['Cookie'] = this._cookieHeader!;
		if (this._bpmCsrf) h['BPMCSRF'] = this._bpmCsrf;
		return h;
	}

	public async refresh(): Promise<void> {
		this._cookieHeader = undefined;
		await this._ensureSession();
	}

	private async _ensureSession() {
		if (this._cookieHeader) return;
		const url = `${this._config.baseUrl.replace(/\/$/, '')}/ServiceModel/AuthService.svc/Login`;
		const body = JSON.stringify({
			UserName:
				this._config.auth.kind === 'legacy' ? (this._config.auth as any).login : undefined,
			UserPassword:
				this._config.auth.kind === 'legacy'
					? (this._config.auth as any).password
					: undefined,
		});
		log.creatioAuthStart(this._config.baseUrl, 'legacy');
		const res = await fetch(url, {
			method: 'POST',
			headers: buildHeaders(JSON_ACCEPT, true),
			body,
			redirect: 'manual',
		});
		if (!res.ok) {
			const responseText = await res.text().catch(() => '');
			log.creatioAuthFailed(this._config.baseUrl, `${res.status} ${responseText}`, 'legacy');
			throw new Error(`auth_failed:${res.status} ${responseText}`);
		}
		log.creatioAuthOk(this._config.baseUrl, 'legacy');
		let setCookie: string[] = [];
		if (typeof (res.headers as any).getSetCookie === 'function') {
			setCookie = (res.headers as any).getSetCookie();
		} else if ((res.headers as any).raw && (res.headers as any).raw()['set-cookie']) {
			setCookie = (res.headers as any).raw()['set-cookie'];
		} else {
			setCookie = [];
		}
		const pairs = parseSetCookie(setCookie);
		if (!pairs.length) throw new Error('auth_failed:no_set_cookie');
		this._cookieHeader = pairs.map((c) => `${c.name}=${c.value}`).join('; ');
		const csrf = pairs.find((c) => c.name.toUpperCase() === 'BPMCSRF')?.value;
		if (csrf) this._bpmCsrf = csrf;
	}
}

/**
 * Manager that composes a concrete provider based on the client config.
 */
export class CreatioAuthManager {
	private readonly _provider: IAuthProvider;

	constructor(private readonly _config: CreatioClientConfig) {
		if (this._config.auth.kind === 'oauth2') this._provider = new OAuth2Provider(this._config);
		else this._provider = new LegacyProvider(this._config);
	}

	public async getJsonHeaders(): Promise<Record<string, string>> {
		return this._provider.getHeaders(JSON_ACCEPT, true);
	}

	public async getXmlHeaders(): Promise<Record<string, string>> {
		return this._provider.getHeaders(XML_ACCEPT, false);
	}

	public async refresh(): Promise<void> {
		return this._provider.refresh();
	}
}
