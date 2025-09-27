import { AsyncLocalStorage } from 'node:async_hooks';

import { SessionContext } from '../services';

export type RequestContext = {
	userKey?: string | undefined;
	sessionId?: string | undefined;
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
