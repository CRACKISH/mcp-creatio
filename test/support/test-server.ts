import { AuthProviderType } from '../../src/creatio';
import { HttpServer } from '../../src/server/http/httpServer';
import { SessionContext } from '../../src/services/session-context';
import { getUserKey } from '../../src/utils';

import type { Server } from '../../src/server/mcp';

export interface AuthProviderMock {
	type: AuthProviderType;
	revokeUserKeys: string[];
	finishCodes: string[];
	getHeaders(): Promise<Record<string, string>>;
	refresh(): Promise<void>;
	revoke(): Promise<void>;
	getAuthorizeUrl(state: string): Promise<string>;
	finishAuthorization(code: string): Promise<void>;
	cancelAllRefresh(): void;
}

export function createAuthProviderMock(): AuthProviderMock {
	return {
		type: AuthProviderType.OAuth2Code,
		revokeUserKeys: [],
		finishCodes: [],
		async getHeaders() {
			return {};
		},
		async refresh() {
			/* noop */
		},
		async revoke() {
			this.revokeUserKeys.push(getUserKey() ?? '<none>');
		},
		async getAuthorizeUrl(state: string) {
			return `https://id.creatio.local/connect/authorize?client_id=creatio&state=${encodeURIComponent(state)}`;
		},
		async finishAuthorization(code: string) {
			this.finishCodes.push(code);
		},
		cancelAllRefresh() {
			/* noop */
		},
	};
}

export function resetSessionContext(): void {
	const sc = SessionContext.instance as unknown as {
		_sessions: Map<string, unknown>;
		_userTokens: Map<string, unknown>;
		_oauthStates: Map<string, unknown>;
		_deletingSessions: Set<string>;
	};
	sc._sessions.clear();
	sc._userTokens.clear();
	sc._oauthStates.clear();
	sc._deletingSessions.clear();
}

export function createTestServer() {
	const authProvider = createAuthProviderMock();
	const fakeServer = {
		get authProvider() {
			return authProvider;
		},
		async startMcp() {
			return {};
		},
		async stopMcp() {
			/* noop */
		},
	};
	const httpServer = new HttpServer(fakeServer as unknown as Server);
	return {
		httpServer,
		app: httpServer.app,
		authProvider,
		sessionContext: SessionContext.instance,
	};
}
