import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import log from '../log';

import { InMemoryTokenStore, TokenStore } from './token-store';

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
	private static _instance: SessionContext | undefined;
	private readonly _sessions = new Map<string, SessionInfo>();
	private readonly _deletingSessions = new Set<string>();
	// Broker-mode Creatio token store. Defaults to in-memory (single instance, lost on restart);
	// swapped for the Redis store at startup via {@link setTokenStore} when configured.
	private _tokenStore: TokenStore = new InMemoryTokenStore();

	public static get instance(): SessionContext {
		if (!SessionContext._instance) {
			SessionContext._instance = new SessionContext();
		}
		return SessionContext._instance;
	}

	/** Swap the broker token store (e.g. Redis) — call once at startup, broker mode only. */
	public setTokenStore(store: TokenStore): void {
		this._tokenStore = store;
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

	public getStats(): { sessionsCount: number } {
		return { sessionsCount: this._sessions.size };
	}

	// --- Per-user Creatio token store (broker mode only) — delegated to the configured TokenStore ---

	public getTokensForUser(userKey: string): Promise<UserTokens | null> {
		return this._tokenStore.get(userKey);
	}

	public setTokensForUser(userKey: string, tokens: UserTokens): Promise<void> {
		return this._tokenStore.set(userKey, tokens);
	}

	public deleteTokensForUser(userKey: string): Promise<void> {
		return this._tokenStore.delete(userKey);
	}

	/** Evict stale token entries (no-op for a store with native key-expiry, e.g. Redis). */
	public evictStaleTokens(now: number = Date.now()): Promise<number> {
		return this._tokenStore.evictStale(now);
	}
}
