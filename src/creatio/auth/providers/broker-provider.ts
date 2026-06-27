import { SessionContext, UserTokens } from '../../../sessions';
import { getEffectiveUserKey } from '../../../utils';
import { BrokerAuthConfig, CreatioClientConfig } from '../../client-config';
import { buildHeaders } from '../auth';

import { BaseProvider } from './base-provider';
import { CreatioOAuthClient } from './creatio-oauth-client';

/**
 * Runtime auth provider for `broker` mode. The broker handler has already brokered the user's
 * Creatio login and stored their tokens per `userKey`; this provider only SERVES them: it reads the
 * current request's user tokens, refreshes on demand when expired, and attaches the Bearer. Token
 * acquisition lives in the broker handler — this side never drives the interactive flow (SRP).
 */
export class BrokerProvider extends BaseProvider<BrokerAuthConfig> {
	private readonly _session = SessionContext.instance;
	private readonly _creatio: CreatioOAuthClient;
	// Deduplicates concurrent refreshes per user so K parallel requests trigger one refresh, not K
	// (avoids the thundering herd + rotating-refresh-token races).
	private readonly _inflightRefresh = new Map<string, Promise<UserTokens>>();

	constructor(config: CreatioClientConfig) {
		super(config);
		this._creatio = new CreatioOAuthClient(config.baseUrl, this.authConfig);
	}

	public async getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		const userKey = getEffectiveUserKey();
		if (!userKey) {
			throw new Error('broker_no_user');
		}
		return buildHeaders(accept, Boolean(isJson), await this._ensureAccessToken(userKey));
	}

	/** Forces a refresh for the current user (called by the HTTP client on a 401, then it retries). */
	public async refresh(): Promise<void> {
		const userKey = getEffectiveUserKey();
		if (!userKey) {
			return;
		}
		const saved = await this._session.getTokensForUser(userKey);
		if (saved?.refreshToken) {
			await this._refreshDeduped(userKey, saved.refreshToken);
		}
	}

	private async _ensureAccessToken(userKey: string): Promise<string> {
		const saved = await this._session.getTokensForUser(userKey);
		if (!saved) {
			throw new Error('broker_not_authorized');
		}
		if (Date.now() < saved.accessTokenExpiryMs) {
			return saved.accessToken;
		}
		if (!saved.refreshToken) {
			await this._session.deleteTokensForUser(userKey);
			throw new Error('broker_token_expired');
		}
		return (await this._refreshDeduped(userKey, saved.refreshToken)).accessToken;
	}

	private _refreshDeduped(userKey: string, refreshToken: string): Promise<UserTokens> {
		const existing = this._inflightRefresh.get(userKey);
		if (existing) {
			return existing;
		}
		const promise = (async () => {
			const updated = await this._creatio.refresh(refreshToken);
			await this._session.setTokensForUser(userKey, updated);
			return updated;
		})().finally(() => this._inflightRefresh.delete(userKey));
		this._inflightRefresh.set(userKey, promise);
		return promise;
	}
}
