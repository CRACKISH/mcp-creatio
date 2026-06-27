import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionContext } from '../../src/sessions/session-context';
import { TokenRefreshScheduler } from '../../src/sessions/token-refresh-scheduler';
import { resetSessionContext } from '../support/test-server';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

describe('TokenRefreshScheduler', () => {
	beforeEach(() => {
		resetSessionContext();
		vi.useFakeTimers();
	});

	afterEach(() => vi.useRealTimers());

	it('schedules a periodic refresh that invokes the callback for an active user', async () => {
		const cb = vi.fn().mockResolvedValue(undefined);
		const scheduler = new TokenRefreshScheduler();
		scheduler.setRefreshCallback(cb);
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: 1,
			refreshToken: 'r',
		});
		SessionContext.instance.createSession('s1', 'u1');

		scheduler.scheduleRefresh('u1');
		expect(scheduler.getStats().activeRefreshCount).toBe(1);

		await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
		expect(cb).toHaveBeenCalledWith('u1');

		scheduler.cancelAllRefresh();
		expect(scheduler.getStats().activeRefreshCount).toBe(0);
	});

	it('cancels the timer when the refresh fails (no active sessions)', async () => {
		const cb = vi.fn().mockResolvedValue(undefined);
		const scheduler = new TokenRefreshScheduler();
		scheduler.setRefreshCallback(cb);
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: 1,
			refreshToken: 'r',
		});
		// no session for u1 -> _refreshUserTokens throws -> the interval cancels itself
		scheduler.scheduleRefresh('u1');
		await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
		expect(cb).not.toHaveBeenCalled();
		expect(scheduler.getStats().activeRefreshCount).toBe(0);
	});

	it('re-scheduling the same user replaces the previous timer', () => {
		const scheduler = new TokenRefreshScheduler();
		scheduler.setRefreshCallback(vi.fn());
		scheduler.scheduleRefresh('u1');
		scheduler.scheduleRefresh('u1');
		expect(scheduler.getStats().activeRefreshCount).toBe(1);
		expect(scheduler.getStats().userKeys).toEqual(['u1']);
		scheduler.cancelRefresh('u1');
		expect(scheduler.getStats().activeRefreshCount).toBe(0);
	});
});
