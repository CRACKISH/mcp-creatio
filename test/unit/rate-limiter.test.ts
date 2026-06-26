import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../../src/server/http/rate-limiter';

describe('RateLimiter (H4)', () => {
	it('allows up to max within the window, then blocks with Retry-After', () => {
		const rl = new RateLimiter({ windowMs: 1000, max: 3 });
		const t = 1_000_000;
		expect(rl.check('ip', t).allowed).toBe(true);
		expect(rl.check('ip', t).allowed).toBe(true);
		expect(rl.check('ip', t).allowed).toBe(true);
		const blocked = rl.check('ip', t);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterMs).toBeGreaterThan(0);
		expect(blocked.retryAfterMs).toBeLessThanOrEqual(1000);
	});

	it('resets the counter once the window elapses', () => {
		const rl = new RateLimiter({ windowMs: 1000, max: 1 });
		const t = 5_000_000;
		expect(rl.check('ip', t).allowed).toBe(true);
		expect(rl.check('ip', t).allowed).toBe(false);
		expect(rl.check('ip', t + 1000).allowed).toBe(true);
	});

	it('tracks each key independently', () => {
		const rl = new RateLimiter({ windowMs: 1000, max: 1 });
		const t = 1;
		expect(rl.check('a', t).allowed).toBe(true);
		expect(rl.check('b', t).allowed).toBe(true);
		expect(rl.check('a', t).allowed).toBe(false);
	});
});
