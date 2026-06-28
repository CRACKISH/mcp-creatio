import { afterEach, describe, expect, it, vi } from 'vitest';

import { keepAliveIntervalMs, SessionKeepAlive } from '../../src/server/keepalive';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('keepAliveIntervalMs', () => {
	it('is disabled (0) when unset or non-positive', () => {
		vi.stubEnv('CREATIO_MCP_KEEPALIVE_SECONDS', '');
		expect(keepAliveIntervalMs()).toBe(0);
		vi.stubEnv('CREATIO_MCP_KEEPALIVE_SECONDS', '0');
		expect(keepAliveIntervalMs()).toBe(0);
		vi.stubEnv('CREATIO_MCP_KEEPALIVE_SECONDS', 'nope');
		expect(keepAliveIntervalMs()).toBe(0);
	});

	it('converts seconds to ms', () => {
		vi.stubEnv('CREATIO_MCP_KEEPALIVE_SECONDS', '300');
		expect(keepAliveIntervalMs()).toBe(300_000);
	});
});

describe('SessionKeepAlive', () => {
	it('pings on the interval and stops cleanly', () => {
		vi.useFakeTimers();
		const ping = vi.fn(async () => {});
		const ka = new SessionKeepAlive(1000, ping);
		ka.start();
		vi.advanceTimersByTime(3000);
		expect(ping).toHaveBeenCalledTimes(3);
		ka.stop();
		vi.advanceTimersByTime(3000);
		expect(ping).toHaveBeenCalledTimes(3);
	});

	it('is a no-op when the interval is 0 (disabled)', () => {
		vi.useFakeTimers();
		const ping = vi.fn(async () => {});
		new SessionKeepAlive(0, ping).start();
		vi.advanceTimersByTime(10_000);
		expect(ping).not.toHaveBeenCalled();
	});

	it('keeps running when a ping rejects (errors are swallowed)', async () => {
		vi.useFakeTimers();
		const ping = vi.fn(async () => {
			throw new Error('boom');
		});
		const ka = new SessionKeepAlive(1000, ping);
		ka.start();
		await vi.advanceTimersByTimeAsync(2000);
		expect(ping).toHaveBeenCalledTimes(2);
		ka.stop();
	});
});
