import { OAuth2AuthConfig } from '../../client-config';
import { EXPIRES_MARGIN_SECONDS, buildHeaders, resolveIdentityBase } from '../auth';

import { BaseProvider } from './base-provider';

/** The raw result of a token fetch — caching and expiry math live in the base. */
export interface FetchedToken {
	accessToken: string;
	expiresInSeconds: number;
}

export abstract class BaseOAuth2Provider<
	T extends OAuth2AuthConfig = OAuth2AuthConfig,
> extends BaseProvider<T> {
	protected abstract readonly authErrorCode: string;

	protected accessToken: string | undefined;

	protected accessTokenExpiryMs: number | undefined;

	// Single-flight: K concurrent callers that find the token expired (e.g. a burst of requests all
	// 401ing at once) trigger ONE token fetch, not K — avoids a thundering herd against Creatio
	// Identity on expiry. Mirrors the per-user dedup the broker provider already does.
	private _inflight: Promise<string | undefined> | undefined;

	/** Raw token acquisition (the network call only); returns undefined on failure. */
	protected abstract fetchToken(): Promise<FetchedToken | undefined>;

	protected computeExpiryMs(expiresInSeconds: number, minSeconds: number = 1): number {
		return Date.now() + Math.max(minSeconds, expiresInSeconds - EXPIRES_MARGIN_SECONDS) * 1000;
	}

	protected getIdentityBase(): string {
		return resolveIdentityBase(this.config.baseUrl, this.authConfig.idBaseUrl);
	}

	protected throwNoTokenError(): void {
		throw new Error(this.authErrorCode);
	}

	private _isFresh(): boolean {
		return Boolean(
			this.accessToken && this.accessTokenExpiryMs && Date.now() < this.accessTokenExpiryMs,
		);
	}

	protected async ensureAccessToken(force = false): Promise<string | undefined> {
		if (!force && this._isFresh()) {
			return this.accessToken;
		}
		if (this._inflight) {
			return this._inflight;
		}
		this._inflight = this._acquireToken().finally(() => {
			this._inflight = undefined;
		});
		return this._inflight;
	}

	private async _acquireToken(): Promise<string | undefined> {
		const fetched = await this.fetchToken();
		if (!fetched) {
			this.accessToken = undefined;
			this.accessTokenExpiryMs = undefined;
			return undefined;
		}
		this.accessToken = fetched.accessToken;
		this.accessTokenExpiryMs = this.computeExpiryMs(fetched.expiresInSeconds, 1);
		return this.accessToken;
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
