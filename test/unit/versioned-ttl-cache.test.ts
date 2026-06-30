import { afterEach, describe, expect, it, vi } from 'vitest';

import { VersionedTtlCache } from '../../src/creatio/services/versioned-ttl-cache';

describe('VersionedTtlCache', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns a stored value on a version + TTL hit', () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		cache.set('a', 42, 'v1', 0);
		expect(cache.get('a', 'v1', 100)).toBe(42);
	});

	it('misses on an unknown key', () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		expect(cache.get('nope', 'v1', 0)).toBeUndefined();
	});

	it('misses when the version no longer matches (data model changed)', () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		cache.set('a', 1, 'v1', 0);
		expect(cache.get('a', 'v2', 0)).toBeUndefined();
	});

	it('treats >= TTL as expired', () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		cache.set('a', 1, 'v1', 0);
		expect(cache.get('a', 'v1', 999)).toBe(1);
		expect(cache.get('a', 'v1', 1000)).toBeUndefined();
	});

	it('evicts the least-recently-used key past maxEntries, honouring a get() touch', () => {
		const cache = new VersionedTtlCache<string>(10_000, 2);
		cache.set('a', 'A', 'v', 1);
		cache.set('b', 'B', 'v', 2);
		cache.get('a', 'v', 3); // touch a → b becomes the coldest
		cache.set('c', 'C', 'v', 4); // size 3 > cap 2 → evict LRU = b
		expect(cache.get('a', 'v', 5)).toBe('A');
		expect(cache.get('c', 'v', 5)).toBe('C');
		expect(cache.get('b', 'v', 5)).toBeUndefined();
		expect(cache.size).toBe(2);
	});

	it('prunes TTL-expired entries on set', () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		cache.set('old', 1, 'v', 0);
		cache.set('new', 2, 'v', 2000); // storing at t=2000 prunes 'old' (stored t=0, ttl 1000)
		expect(cache.size).toBe(1);
		expect(cache.get('new', 'v', 2000)).toBe(2);
	});

	it('defaults to real time when now is omitted', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const cache = new VersionedTtlCache<number>(1000, 10);
		cache.set('a', 1, 'v');
		expect(cache.get('a', 'v')).toBe(1);
		vi.setSystemTime(1001);
		expect(cache.get('a', 'v')).toBeUndefined();
	});

	it('getOrLoad coalesces concurrent misses into a single loader call', async () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const loader = async () => {
			calls++;
			await gate;
			return 7;
		};
		const a = cache.getOrLoad('k', 'v', loader);
		const b = cache.getOrLoad('k', 'v', loader);
		release();
		expect(await a).toBe(7);
		expect(await b).toBe(7);
		expect(calls).toBe(1);
	});

	it('getOrLoad caches the loaded value for later hits', async () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		let calls = 0;
		await cache.getOrLoad('k', 'v', async () => {
			calls++;
			return 1;
		});
		await cache.getOrLoad('k', 'v', async () => {
			calls++;
			return 2;
		});
		expect(calls).toBe(1);
		expect(cache.get('k', 'v')).toBe(1);
	});

	it('getOrLoad does not cache a rejected load and retries next time', async () => {
		const cache = new VersionedTtlCache<number>(1000, 10);
		await expect(
			cache.getOrLoad('k', 'v', async () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');
		expect(cache.size).toBe(0);
		expect(await cache.getOrLoad('k', 'v', async () => 9)).toBe(9);
	});

	it('getOrLoad does not coalesce across different versions', async () => {
		const cache = new VersionedTtlCache<string>(1000, 10);
		let calls = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const a = cache.getOrLoad('k', 'v1', async () => {
			calls++;
			await gate;
			return 'A';
		});
		const b = cache.getOrLoad('k', 'v2', async () => {
			calls++;
			await gate;
			return 'B';
		});
		release();
		await a;
		await b;
		expect(calls).toBe(2);
	});
});
