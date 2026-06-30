import { AsyncLocalStorage } from 'node:async_hooks';

import { SessionContext } from '../sessions';

/**
 * A Creatio credential supplied per-request by an external party in the stateless passthrough modes
 * (delegated / gateway): the MCP stores nothing and just forwards it, letting Creatio validate.
 * `bearer` is an OAuth access token; `cookie` is a Forms-auth session (the raw Cookie header) plus
 * its BPMCSRF anti-forgery token. The union is open to more shapes (e.g. basic) without touching
 * the callers that only branch on `kind`.
 */
export type InjectedCredential =
	| { kind: 'bearer'; token: string }
	| { kind: 'cookie'; cookie: string; bpmcsrf?: string | undefined };

export type RequestContext = {
	userKey?: string | undefined;
	sessionId?: string | undefined;
	/**
	 * The credential the client (delegated) or gateway supplied for this request; the bearer auth
	 * provider forwards it straight to Creatio. Absent for legacy / client-credentials (those
	 * self-authenticate with one configured identity) and for broker (the MCP owns the token).
	 */
	credential?: InjectedCredential | undefined;
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
	if (ctx.credential) {
		store.credential = ctx.credential;
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

/** The per-request injected Creatio credential (stateless delegated/gateway passthrough), if any. */
export function getInjectedCredential(): InjectedCredential | undefined {
	return als.getStore()?.credential;
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
