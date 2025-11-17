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
}

export interface OAuthState {
	userKey: string;
	createdAt: number;
	expiresAt: number;
}

export class SessionContext {
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
		return (
			Math.random().toString(36).substring(2, 15) +
			Math.random().toString(36).substring(2, 15)
		);
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
		this._userTokens.set(userKey, tokens);
	}

	public async deleteTokensForUser(userKey: string): Promise<void> {
		this._userTokens.delete(userKey);
	}

	public createOAuthState(userKey: string): string {
		const state = this._generateState();
		const stateInfo: OAuthState = {
			userKey,
			createdAt: Date.now(),
			expiresAt: Date.now() + 10 * 60 * 1000,
		};
		this._oauthStates.set(state, stateInfo);
		return state;
	}

	public validateOAuthState(state: string): {
		userKey: string;
	} | null {
		const stateInfo = this._oauthStates.get(state);
		if (!stateInfo) {
			return null;
		}
		if (Date.now() > stateInfo.expiresAt) {
			this._oauthStates.delete(state);
			return null;
		}
		this._oauthStates.delete(state);
		return { userKey: stateInfo.userKey };
	}

	public validateAndConsumeOAuthState(state: string): string | undefined {
		const result = this.validateOAuthState(state);
		return result?.userKey;
	}

	public setSessionUserKey(sessionId: string, userKey: string): void {
		const session = this._sessions.get(sessionId);
		if (session) {
			session.userKey = userKey;
			log.info('session_mapping.set', { sessionId, userKey });
		}
	}

	public cleanupExpiredOAuthStates(): void {
		const now = Date.now();
		for (const [state, stateInfo] of this._oauthStates.entries()) {
			if (now > stateInfo.expiresAt) {
				this._oauthStates.delete(state);
			}
		}
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

	public mapAllSessionsToUser(userKey: string): void {
		const sessionIds: string[] = [];
		for (const [sessionId, session] of this._sessions.entries()) {
			if (session.transport) {
				session.userKey = userKey;
				sessionIds.push(sessionId);
			}
		}
		log.info('mapping_all_sessions', {
			userKey,
			sessionCount: sessionIds.length,
			sessionIds,
		});
	}

	public getStats(): { sessionsCount: number; tokensCount: number; oauthStatesCount: number } {
		return {
			sessionsCount: this._sessions.size,
			tokensCount: this._userTokens.size,
			oauthStatesCount: this._oauthStates.size,
		};
	}
}
