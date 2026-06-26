import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext } from '../../src/services/session-context';

describe('SessionContext session lifecycle', () => {
	let sc: SessionContext;

	beforeEach(() => {
		sc = new SessionContext();
	});

	it('creates sessions with optional userKey / remoteIp', () => {
		const s = sc.createSession('s1', 'u1', '1.2.3.4');
		expect(s).toMatchObject({ id: 's1', userKey: 'u1', remoteIp: '1.2.3.4', isLogged: false });
		expect(sc.hasSession('s1')).toBe(true);
		expect(sc.getSession('s1')).toBe(s);
	});

	it('marks a session as logged', () => {
		sc.createSession('s1');
		expect(sc.markSessionAsLogged('s1')).toBe(true);
		expect(sc.getSession('s1')?.isLogged).toBe(true);
		expect(sc.markSessionAsLogged('missing')).toBe(false);
	});

	it('sets a transport and maps a session to a user', () => {
		sc.createSession('s1');
		const transport = { close: vi.fn() } as never;
		sc.setSessionTransport('s1', transport);
		expect(sc.getSession('s1')?.transport).toBe(transport);
		sc.mapSessionToUser('s1', 'u9');
		expect(sc.getSession('s1')?.userKey).toBe('u9');
	});

	it('deletes a session, closes its transport, and is safe to repeat', () => {
		sc.createSession('s1');
		const transport = { close: vi.fn() } as unknown as { close: () => void };
		sc.setSessionTransport('s1', transport as never);
		sc.deleteSession('s1');
		expect(sc.hasSession('s1')).toBe(false);
		expect(transport.close).toHaveBeenCalled();
		sc.deleteSession('s1'); // no throw on unknown
	});

	it('lists all sessions and filters by user', () => {
		sc.createSession('s1', 'u1');
		sc.createSession('s2', 'u1');
		sc.createSession('s3', 'u2');
		expect(sc.getAllSessions()).toHaveLength(3);
		expect(sc.getSessionsForUser('u1').map((s) => s.id)).toEqual(['s1', 's2']);
	});

	it('is a process-wide singleton', () => {
		expect(SessionContext.instance).toBe(SessionContext.instance);
	});
});

describe('SessionContext token storage', () => {
	let sc: SessionContext;

	beforeEach(() => {
		sc = new SessionContext();
	});

	it('stores, reads by user and by session, and deletes tokens', async () => {
		await sc.setTokensForUser('u1', { accessToken: 'a', accessTokenExpiryMs: 1 });
		expect((await sc.getTokensForUser('u1'))?.accessToken).toBe('a');
		sc.createSession('s1', 'u1');
		expect((await sc.getTokensForSession('s1'))?.accessToken).toBe('a');
		expect(await sc.getTokensForSession('missing')).toBeNull();
		await sc.deleteTokensForUser('u1');
		expect(await sc.getTokensForUser('u1')).toBeNull();
	});

	it('getEffectiveTokens prefers userKey, then sessionId, else null', async () => {
		await sc.setTokensForUser('u1', { accessToken: 'a', accessTokenExpiryMs: 1 });
		sc.createSession('s1', 'u1');
		expect((await sc.getEffectiveTokens(undefined, 'u1'))?.accessToken).toBe('a');
		expect((await sc.getEffectiveTokens('s1'))?.accessToken).toBe('a');
		expect(await sc.getEffectiveTokens()).toBeNull();
	});

	it('createSessionWithUser maps the session and reports stats', async () => {
		await sc.createSessionWithUser('s1', 'u1', '1.1.1.1');
		expect(sc.getSession('s1')?.userKey).toBe('u1');
		expect(sc.getStats().sessionsCount).toBe(1);
	});
});

describe('SessionContext token eviction', () => {
	let sc: SessionContext;
	const NOW = 1_000_000;

	beforeEach(() => {
		sc = new SessionContext();
	});

	it('keeps unexpired tokens regardless of sessions', async () => {
		await sc.setTokensForUser('u1', { accessToken: 'a', accessTokenExpiryMs: NOW + 5000 });
		expect(sc.evictStaleTokens(NOW)).toBe(0);
		expect((await sc.getTokensForUser('u1'))?.accessToken).toBe('a');
	});

	it('evicts an expired token with no refresh token', async () => {
		await sc.setTokensForUser('u1', { accessToken: 'a', accessTokenExpiryMs: NOW - 1 });
		expect(sc.evictStaleTokens(NOW)).toBe(1);
		expect(await sc.getTokensForUser('u1')).toBeNull();
	});

	it('evicts an expired refreshable token when no session anchors it', async () => {
		await sc.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: NOW - 1,
			refreshToken: 'r',
		});
		expect(sc.evictStaleTokens(NOW)).toBe(1);
		expect(await sc.getTokensForUser('u1')).toBeNull();
	});

	it('keeps an expired refreshable token while a session is still active', async () => {
		await sc.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: NOW - 1,
			refreshToken: 'r',
		});
		sc.createSession('s1', 'u1');
		expect(sc.evictStaleTokens(NOW)).toBe(0);
		expect((await sc.getTokensForUser('u1'))?.refreshToken).toBe('r');
	});
});

describe('SessionContext OAuth-state cleanup', () => {
	afterEach(() => vi.useRealTimers());

	it('cleanupExpiredOAuthStates evicts only expired states', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const sc = new SessionContext();
		sc.createOAuthState('u1');
		expect(sc.getStats().oauthStatesCount).toBe(1);
		vi.setSystemTime(10 * 60 * 1000 + 1);
		sc.cleanupExpiredOAuthStates();
		expect(sc.getStats().oauthStatesCount).toBe(0);
	});
});
