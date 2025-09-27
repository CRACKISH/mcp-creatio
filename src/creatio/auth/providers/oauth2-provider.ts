import log from '../../../log';
import { CreatioClientConfig, OAuth2AuthConfig } from '../../client-config';
import { TOKEN_BODY_SNIPPET_MAX, TOKEN_ENDPOINT } from '../auth';

import { BaseOAuth2Provider } from './base-oauth2-provider';

export class OAuth2Provider extends BaseOAuth2Provider<OAuth2AuthConfig> {
	protected readonly authErrorCode = 'oauth2_auth_failed';

	constructor(private readonly _config: CreatioClientConfig) {
		super(_config);
	}

	protected async ensureAccessToken(): Promise<string | undefined> {
		const now = Date.now();
		if (this.accessToken && this.accessTokenExpiryMs && now < this.accessTokenExpiryMs) {
			return this.accessToken;
		}
		const url = `${this.getIdentityBase()}${TOKEN_ENDPOINT}`;
		const body = new URLSearchParams();
		body.set('grant_type', 'client_credentials');
		body.set('client_id', this.authConfig.clientId);
		body.set('client_secret', this.authConfig.clientSecret);
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
			this.accessToken = String(tokenResponse.access_token);
			const expiresIn = Number(tokenResponse.expires_in) || 3600;
			this.accessTokenExpiryMs = this.computeExpiryMs(expiresIn, 1);
			log.creatioAuthOk(this._config.baseUrl, 'oauth2');
			return this.accessToken;
		} catch (e: any) {
			log.error('oauth.token.exception', { error: String(e?.message ?? e) });
			log.creatioAuthFailed(this._config.baseUrl, String(e?.message ?? e), 'oauth2');
			return undefined;
		}
	}
}
