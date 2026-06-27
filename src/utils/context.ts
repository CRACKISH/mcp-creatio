import { AsyncLocalStorage } from 'node:async_hooks';

import { SessionContext } from '../sessions';

export type RequestContext = {
	userKey?: string | undefined;
	sessionId?: string | undefined;
	/**
	 * The raw Bearer token from the incoming request, in the stateless per-request auth model
	 * (delegated/gateway). It is the Creatio access token the client/gateway obtained; the bearer
	 * auth provider passes it straight through to Creatio. Absent for legacy/client-credentials.
	 */
	bearerToken?: string | undefined;
	/** Optional per-request Creatio instance override (gateway multi-tenant), from X-Creatio-Base-Url. */
	baseUrlOverride?: string | undefined;
};

const als = new AsyncLocalStorage<RequestContext>();

const sessionContext = SessionContext.instance;

export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
	const store: RequestContext = {};
	if (typeof ctx.userKey === 'string') {
		store.userKey = ctx.userKey;
	}
	if (typeof ctx.sessionId === 'string') {
		store.sessionId = ctx.sessionId;
	}
	if (typeof ctx.bearerToken === 'string') {
		store.bearerToken = ctx.bearerToken;
	}
	if (typeof ctx.baseUrlOverride === 'string') {
		store.baseUrlOverride = ctx.baseUrlOverride;
	}
	return als.run(store, fn);
}

export function getRequestContext(): RequestContext | undefined {
	return als.getStore();
}

export function getUserKey(): string | undefined {
	return als.getStore()?.userKey;
}

export function getSessionId(): string | undefined {
	return als.getStore()?.sessionId;
}

/** The raw per-request Bearer token (stateless delegated/gateway auth), if any. */
export function getBearerToken(): string | undefined {
	return als.getStore()?.bearerToken;
}

/** The per-request Creatio base-URL override (gateway multi-tenant), if any. */
export function getBaseUrlOverride(): string | undefined {
	return als.getStore()?.baseUrlOverride;
}

export function getEffectiveUserKey(): string | undefined {
	const ctx = als.getStore();
	if (ctx?.userKey) {
		return ctx.userKey;
	}
	if (ctx?.sessionId) {
		const session = sessionContext.getSession(ctx.sessionId);
		if (session?.userKey) {
			return session.userKey;
		}
	}
	return ctx?.sessionId;
}
