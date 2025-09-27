import log from '../log';
import { SessionContext } from '../services';

export type TokenRefreshCallback = (userKey: string) => Promise<void>;

export class TokenRefreshScheduler {
	private _refreshIntervals = new Map<string, NodeJS.Timeout>();
	private readonly _sessionContext = SessionContext.instance;
	private _refreshCallback?: TokenRefreshCallback;

	private async _refreshUserTokens(userKey: string): Promise<void> {
		if (!this._refreshCallback) {
			throw new Error('no_refresh_callback');
		}

		const tokens = await this._sessionContext.getTokensForUser(userKey);
		if (!tokens?.refreshToken) {
			throw new Error('no_refresh_token');
		}

		const sessions = this._sessionContext.getSessionsForUser(userKey);
		if (sessions.length === 0) {
			throw new Error('no_active_sessions');
		}

		await this._refreshCallback(userKey);
		log.info('background_token_refresh_success', { userKey, sessionsCount: sessions.length });
	}

	public setRefreshCallback(callback: TokenRefreshCallback): void {
		this._refreshCallback = callback;
	}

	public scheduleRefresh(userKey: string): void {
		this.cancelRefresh(userKey);

		const refreshInterval = setInterval(
			async () => {
				try {
					await this._refreshUserTokens(userKey);
				} catch (err) {
					log.warn('background_token_refresh_failed', { userKey, error: String(err) });
					this.cancelRefresh(userKey);
				}
			},
			15 * 60 * 1000,
		);

		this._refreshIntervals.set(userKey, refreshInterval);
		log.info('token_refresh_scheduled', { userKey });
	}

	public cancelRefresh(userKey: string): void {
		const interval = this._refreshIntervals.get(userKey);
		if (interval) {
			clearInterval(interval);
			this._refreshIntervals.delete(userKey);
			log.info('token_refresh_cancelled', { userKey });
		}
	}

	public cancelAllRefresh(): void {
		for (const userKey of this._refreshIntervals.keys()) {
			this.cancelRefresh(userKey);
		}
	}

	public getStats() {
		return {
			activeRefreshCount: this._refreshIntervals.size,
			userKeys: Array.from(this._refreshIntervals.keys()),
		};
	}
}
