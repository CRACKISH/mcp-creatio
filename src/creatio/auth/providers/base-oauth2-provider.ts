import { OAuth2AuthConfig, OAuth2CodeAuthConfig } from '../../client-config';
import { EXPIRES_MARGIN_SECONDS, buildHeaders } from '../auth';

import { BaseProvider } from './base-provider';

type OAuthConfig = OAuth2AuthConfig | OAuth2CodeAuthConfig;

export abstract class BaseOAuth2Provider<
	T extends OAuthConfig = OAuthConfig,
> extends BaseProvider<T> {
	protected abstract readonly authErrorCode: string;

	protected accessToken: string | undefined;

	protected accessTokenExpiryMs: number | undefined;

	protected abstract ensureAccessToken(force?: boolean): Promise<string | undefined>;

	protected computeExpiryMs(expiresInSeconds: number, minSeconds: number = 1): number {
		return Date.now() + Math.max(minSeconds, expiresInSeconds - EXPIRES_MARGIN_SECONDS) * 1000;
	}

	protected getIdentityBase(): string {
		if (this.authConfig.idBaseUrl) {
			let base = String(this.authConfig.idBaseUrl).replace(/\/$/, '');
			if (!/\/0$/.test(base)) {
				base = base + '/0';
			}
			return base;
		}
		let base = this.config.baseUrl.replace(/\/$/, '');
		if (!/\/0$/.test(base)) {
			base = base + '/0';
		}
		return base;
	}

	protected storageKey(userKey: string): string {
		const base = this.getIdentityBase();
		const kind = (this.config as any)?.auth?.kind ?? 'unknown';
		const clientId = (this.config as any)?.auth?.clientId ?? 'noclient';
		return `${kind}|${base}|${clientId}|${userKey}`;
	}

	protected throwNoTokenError(): void {
		throw new Error(this.authErrorCode);
	}

	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		const token = await this.ensureAccessToken(false);
		if (!token) {
			this.throwNoTokenError();
		}
		return buildHeaders(accept, Boolean(isJson), token);
	}

	public async refresh(): Promise<void> {
		this.accessToken = undefined;
		this.accessTokenExpiryMs = undefined;
		await this.ensureAccessToken(true);
	}
}
