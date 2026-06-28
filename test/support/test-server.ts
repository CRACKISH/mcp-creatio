import { AuthProviderType } from '../../src/creatio';
import { HttpServer } from '../../src/server/http/http-server';
import { SessionContext } from '../../src/sessions/session-context';
import { InMemoryTokenStore } from '../../src/sessions/token-store';

import type { Server } from '../../src/server/mcp';

export interface AuthProviderMock {
	type: AuthProviderType;
	getHeaders(): Promise<Record<string, string>>;
	refresh(): Promise<void>;
	cancelAllRefresh(): void;
}

export function createAuthProviderMock(): AuthProviderMock {
	return {
		type: AuthProviderType.Legacy,
		async getHeaders() {
			return {};
		},
		async refresh() {
			/* noop */
		},
		cancelAllRefresh() {
			/* noop */
		},
	};
}

export function resetSessionContext(): void {
	const sc = SessionContext.instance as unknown as {
		_sessions: Map<string, unknown>;
		_deletingSessions: Set<string>;
	};
	sc._sessions.clear();
	sc._deletingSessions.clear();
	// Fresh token store per test for isolation (broker tests stash per-user Creatio tokens).
	SessionContext.instance.setTokenStore(new InMemoryTokenStore());
}

export function createTestServer() {
	const authProvider = createAuthProviderMock();
	const fakeServer = {
		get authProvider() {
			return authProvider;
		},
		createSessionServer() {
			return { connect: async () => {}, close: () => {} };
		},
		ensureCapabilitiesProbed() {
			/* noop */
		},
		releaseSessionServer() {
			/* noop */
		},
		async stopAll() {
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
