import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext } from '../../src/sessions/session-context';

describe('SessionContext OAuth state (C1 / C2)', () => {
	let ctx: SessionContext;

	beforeEach(() => {
		ctx = new SessionContext();
	});

	it('generates unguessable, unique, crypto-random state tokens', () => {
		const a = ctx.createOAuthState('user-1');
		const b = ctx.createOAuthState('user-1');
		expect(a).not.toBe(b);
		// 32 random bytes => 43-char base64url string (not the old Math.random token).
		expect(a.length).toBeGreaterThanOrEqual(43);
		expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('binds the state to the initiating session and returns it on consume (C1)', () => {
		const state = ctx.createOAuthState('user-1', 'sess-1');
		expect(ctx.validateAndConsumeOAuthState(state)).toEqual({
			userKey: 'user-1',
			sessionId: 'sess-1',
		});
	});

	it('omits sessionId when the flow was not bound to a session', () => {
		const state = ctx.createOAuthState('user-1');
		const result = ctx.validateAndConsumeOAuthState(state);
		expect(result?.userKey).toBe('user-1');
		expect(result?.sessionId).toBeUndefined();
	});

	it('consumes a state only once (no replay)', () => {
		const state = ctx.createOAuthState('user-1', 'sess-1');
		expect(ctx.validateAndConsumeOAuthState(state)).toBeTruthy();
		expect(ctx.validateAndConsumeOAuthState(state)).toBeUndefined();
	});

	it('rejects an expired state', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
			const state = ctx.createOAuthState('user-1');
			vi.advanceTimersByTime(10 * 60 * 1000 + 1);
			expect(ctx.validateAndConsumeOAuthState(state)).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('no longer exposes the cross-user mapAllSessionsToUser (C1 regression)', () => {
		expect((ctx as unknown as Record<string, unknown>).mapAllSessionsToUser).toBeUndefined();
	});
});
