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
});
