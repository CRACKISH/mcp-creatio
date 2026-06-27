import { OAuth2AuthConfig } from '../../client-config';
import { EXPIRES_MARGIN_SECONDS, buildHeaders, resolveIdentityBase } from '../auth';

import { BaseProvider } from './base-provider';

export abstract class BaseOAuth2Provider<
	T extends OAuth2AuthConfig = OAuth2AuthConfig,
> extends BaseProvider<T> {
	protected abstract readonly authErrorCode: string;

	protected accessToken: string | undefined;

	protected accessTokenExpiryMs: number | undefined;

	protected abstract ensureAccessToken(force?: boolean): Promise<string | undefined>;

	protected computeExpiryMs(expiresInSeconds: number, minSeconds: number = 1): number {
		return Date.now() + Math.max(minSeconds, expiresInSeconds - EXPIRES_MARGIN_SECONDS) * 1000;
	}

	protected getIdentityBase(): string {
		return resolveIdentityBase(this.config.baseUrl, this.authConfig.idBaseUrl);
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
