import crypto from 'crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import log from '../log';

export interface SessionInfo {
	id: string;
	userKey?: string | undefined;
	transport?: StreamableHTTPServerTransport | undefined;
	isLogged: boolean;
	createdAt: Date;
	remoteIp?: string | undefined;
}

export interface UserTokens {
	accessToken: string;
	accessTokenExpiryMs: number;
	refreshToken?: string | undefined;
	/** When this entry was stored/last refreshed; set by setTokensForUser. Drives idle eviction. */
	storedAtMs?: number | undefined;
}

export interface OAuthState {
	userKey: string;
	sessionId?: string | undefined;
	createdAt: number;
	expiresAt: number;
}

export interface OAuthStateResult {
	userKey: string;
	sessionId?: string | undefined;
}

export class SessionContext {
	/** Idle window after which a token entry is considered abandoned and evicted, even if it
	 *  still has a refresh token. Generous (24h) so a returning client within a normal working
	 *  day keeps transparent refresh; resets on every store/refresh. */
	private static readonly TOKEN_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
	private static _instance: SessionContext | undefined;
	private readonly _sessions = new Map<string, SessionInfo>();
	private readonly _userTokens = new Map<string, UserTokens>();
	private readonly _oauthStates = new Map<string, OAuthState>();
	private readonly _deletingSessions = new Set<string>();

	public static get instance(): SessionContext {
		if (!SessionContext._instance) {
			SessionContext._instance = new SessionContext();
		}
		return SessionContext._instance;
	}

	private _generateState(): string {
		// Cryptographically secure, unguessable CSRF/state token (CWE-330).
		return crypto.randomBytes(32).toString('base64url');
	}

	public createSession(sessionId: string, userKey?: string, remoteIp?: string): SessionInfo {
		const session: SessionInfo = {
			id: sessionId,
			isLogged: false,
			createdAt: new Date(),
		};
		if (userKey !== undefined) {
			session.userKey = userKey;
		}
		if (remoteIp !== undefined) {
			session.remoteIp = remoteIp;
		}
		this._sessions.set(sessionId, session);
		return session;
	}

	public getSession(sessionId: string): SessionInfo | undefined {
		return this._sessions.get(sessionId);
	}

	public hasSession(sessionId: string): boolean {
		return this._sessions.has(sessionId);
	}

	public markSessionAsLogged(sessionId: string): boolean {
		const session = this._sessions.get(sessionId);
		if (session) {
			session.isLogged = true;
			return true;
		}
		return false;
	}

	public setSessionTransport(sessionId: string, transport: StreamableHTTPServerTransport): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session.transport = transport;
		}
	}

	public mapSessionToUser(sessionId: string, userKey: string): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session.userKey = userKey;
			log.info('session_mapping.set', { sessionId, userKey });
		}
	}

	public deleteSession(sessionId: string): void {
		if (this._deletingSessions.has(sessionId)) {
			return;
		}
		this._deletingSessions.add(sessionId);
		const session = this._sessions.get(sessionId);
		this._sessions.delete(sessionId);
		if (session?.transport) {
			try {
				session.transport.close();
			} catch (err) {
				log.warn('transport.close.failed', { sessionId, error: String(err) });
			}
		}
		this._deletingSessions.delete(sessionId);
	}

	public getAllSessions(): SessionInfo[] {
		return Array.from(this._sessions.values());
	}

	public getSessionsForUser(userKey: string): SessionInfo[] {
		return Array.from(this._sessions.values()).filter((s) => s.userKey === userKey);
	}

	public async getTokensForSession(sessionId: string): Promise<UserTokens | null> {
		const session = this._sessions.get(sessionId);
		if (!session?.userKey) {
			return null;
		}
		return this.getTokensForUser(session.userKey);
	}

	public async getTokensForUser(userKey: string): Promise<UserTokens | null> {
		return this._userTokens.get(userKey) || null;
	}

	public async setTokensForUser(userKey: string, tokens: UserTokens): Promise<void> {
		// Stamp the store time (unless the caller supplied one) so idle eviction can tell a
		// recently-refreshed token from an abandoned one.
		this._userTokens.set(userKey, {
			...tokens,
			storedAtMs: tokens.storedAtMs ?? Date.now(),
		});
	}

	public async deleteTokensForUser(userKey: string): Promise<void> {
		this._userTokens.delete(userKey);
	}

	public createOAuthState(userKey: string, sessionId?: string): string {
		const state = this._generateState();
		const stateInfo: OAuthState = {
			userKey,
			sessionId,
			createdAt: Date.now(),
			expiresAt: Date.now() + 10 * 60 * 1000,
		};
		this._oauthStates.set(state, stateInfo);
		return state;
	}

	public validateOAuthState(state: string): OAuthStateResult | null {
		const stateInfo = this._oauthStates.get(state);
		if (!stateInfo) {
			return null;
		}
		if (Date.now() > stateInfo.expiresAt) {
			this._oauthStates.delete(state);
			return null;
		}
		this._oauthStates.delete(state);
		return { userKey: stateInfo.userKey, sessionId: stateInfo.sessionId };
	}

	public validateAndConsumeOAuthState(state: string): OAuthStateResult | undefined {
		return this.validateOAuthState(state) ?? undefined;
	}

	public cleanupExpiredOAuthStates(): void {
		const now = Date.now();
		for (const [state, stateInfo] of this._oauthStates.entries()) {
			if (now > stateInfo.expiresAt) {
				this._oauthStates.delete(state);
			}
		}
	}

	/**
	 * Bound the per-user token map on a long-running process WITHOUT evicting tokens a client
	 * could still use. Refresh is keyed by userKey (not session) — Bearer clients carry identity
	 * in the JWT and often have no live session between reconnects — so a token is removed only
	 * when it is genuinely unreachable:
	 *  - expired AND has no refresh token (cannot be revived), or
	 *  - idle past {@link TOKEN_IDLE_TTL_MS} since it was last stored/refreshed (abandoned).
	 * Unexpired tokens and recently-stored refreshable tokens are always kept. Returns count removed.
	 */
	public evictStaleTokens(now: number = Date.now()): number {
		let removed = 0;
		for (const [userKey, tokens] of this._userTokens.entries()) {
			const expired = now > tokens.accessTokenExpiryMs;
			const deadNoRefresh = expired && !tokens.refreshToken;
			const idleFor = now - (tokens.storedAtMs ?? now);
			const abandoned = idleFor > SessionContext.TOKEN_IDLE_TTL_MS;
			if (deadNoRefresh || abandoned) {
				this._userTokens.delete(userKey);
				removed++;
			}
		}
		if (removed > 0) {
			log.info('session.tokens.evicted', { removed, remaining: this._userTokens.size });
		}
		return removed;
	}

	public async getEffectiveTokens(
		sessionId?: string,
		userKey?: string,
	): Promise<UserTokens | null> {
		if (userKey) {
			return this.getTokensForUser(userKey);
		}
		if (sessionId) {
			return this.getTokensForSession(sessionId);
		}
		return null;
	}

	public async createSessionWithUser(
		sessionId: string,
		userKey: string,
		remoteIp?: string,
	): Promise<SessionInfo> {
		const session = this.createSession(sessionId, userKey, remoteIp);
		return session;
	}

	public getStats(): { sessionsCount: number; tokensCount: number; oauthStatesCount: number } {
		return {
			sessionsCount: this._sessions.size,
			tokensCount: this._userTokens.size,
			oauthStatesCount: this._oauthStates.size,
		};
	}
}
