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

/**
 * A user's Creatio tokens, held per `userKey` in `broker` mode (the MCP brokered the login, so it
 * owns the refresh lifecycle). Other modes store nothing here.
 */
export interface UserTokens {
	accessToken: string;
	accessTokenExpiryMs: number;
	refreshToken?: string | undefined;
	/** When stored/last refreshed; drives idle eviction. */
	storedAtMs?: number | undefined;
}

/**
 * Tracks live MCP streamable-HTTP sessions (id ↔ transport ↔ user identity) for the HTTP server.
 *
 * In the stateless per-request Bearer model the MCP stores NO tokens: every request carries its own
 * Creatio access token (delegated: from the client; gateway: injected by the Control-Plane). This
 * context therefore only manages transport/session lifecycle and the identity used for logging.
 */
export class SessionContext {
	/** Idle window after which an abandoned token entry is evicted (24h), even if refreshable. */
	private static readonly TOKEN_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
	private static _instance: SessionContext | undefined;
	private readonly _sessions = new Map<string, SessionInfo>();
	private readonly _userTokens = new Map<string, UserTokens>();
	private readonly _deletingSessions = new Set<string>();

	public static get instance(): SessionContext {
		if (!SessionContext._instance) {
			SessionContext._instance = new SessionContext();
		}
		return SessionContext._instance;
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

	public getStats(): { sessionsCount: number; tokensCount: number } {
		return { sessionsCount: this._sessions.size, tokensCount: this._userTokens.size };
	}

	// --- Per-user Creatio token store (broker mode only) ---

	public async getTokensForUser(userKey: string): Promise<UserTokens | null> {
		return this._userTokens.get(userKey) ?? null;
	}

	public async setTokensForUser(userKey: string, tokens: UserTokens): Promise<void> {
		this._userTokens.set(userKey, { ...tokens, storedAtMs: tokens.storedAtMs ?? Date.now() });
	}

	public async deleteTokensForUser(userKey: string): Promise<void> {
		this._userTokens.delete(userKey);
	}

	/**
	 * Keeps the per-user token map bounded over a long-running process without evicting tokens a
	 * client could still use: a token is removed only when expired AND non-refreshable, or idle past
	 * {@link TOKEN_IDLE_TTL_MS}. Returns how many were removed.
	 */
	public evictStaleTokens(now: number = Date.now()): number {
		let removed = 0;
		for (const [userKey, tokens] of this._userTokens) {
			const deadNoRefresh = now > tokens.accessTokenExpiryMs && !tokens.refreshToken;
			const abandoned = now - (tokens.storedAtMs ?? now) > SessionContext.TOKEN_IDLE_TTL_MS;
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
}
