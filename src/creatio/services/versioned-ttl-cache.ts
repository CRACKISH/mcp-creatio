interface CacheBox<V> {
	value: V;
	version: string;
	storedAt: number;
	lastAccessMs: number;
}

/**
 * A per-key cache whose entry is valid only while (a) its stamped freshness `version` still matches
 * and (b) it is within `ttlMs` of being stored, bounded to `maxEntries` by LRU eviction.
 *
 * One abstraction for every "cache something per Creatio base URL, keyed and version-stamped" need —
 * OData `$metadata` documents, OData entity-set lists, and DataService runtime schemas — so the
 * freshness + TTL + eviction policy lives, and is tested, in exactly one place instead of being
 * re-implemented (and drifting) in each schema provider. The `version` is supplied by the caller
 * (typically {@link SchemaFreshnessGate}); when no gate is wired the caller passes a constant and
 * the cache degrades to pure TTL + LRU.
 */
export class VersionedTtlCache<V> {
	private readonly _ttlMs: number;
	private readonly _maxEntries: number;
	private readonly _entries = new Map<string, CacheBox<V>>();
	// In-flight loads for {@link getOrLoad}, keyed by key+version so concurrent misses for the same
	// (key, version) share ONE loader call (single-flight) — and a stale-version miss never coalesces
	// onto a fresh-version load. Cleared as soon as the load settles (whether it resolves or rejects).
	private readonly _inflight = new Map<string, Promise<V>>();

	constructor(ttlMs: number, maxEntries: number) {
		this._ttlMs = ttlMs;
		this._maxEntries = maxEntries;
	}

	public get size(): number {
		return this._entries.size;
	}

	/** The cached value iff present, version-matching and within TTL; otherwise `undefined`. Touches
	 *  recency on a hit so the LRU cap evicts genuinely-cold keys, not just-used ones. */
	public get(key: string, version: string, now: number = Date.now()): V | undefined {
		const box = this._entries.get(key);
		if (!box || box.version !== version || now - box.storedAt >= this._ttlMs) {
			return undefined;
		}
		box.lastAccessMs = now;
		return box.value;
	}

	/** Store (or replace) a value under `key`, then prune TTL-expired entries and enforce the LRU cap. */
	public set(key: string, value: V, version: string, now: number = Date.now()): void {
		this._entries.set(key, { value, version, storedAt: now, lastAccessMs: now });
		this._prune(now);
	}

	/**
	 * Return the cached value, or run `loader` to produce and cache it on a miss. Concurrent misses
	 * for the same (key, version) are coalesced into a single `loader` call (single-flight), so a
	 * burst of cold requests for the same schema/metadata makes ONE network round-trip, not N. A
	 * rejected load is propagated to every waiter and NOT cached, so the next call retries.
	 */
	public async getOrLoad(
		key: string,
		version: string,
		loader: () => Promise<V>,
		now: number = Date.now(),
	): Promise<V> {
		const hit = this.get(key, version, now);
		if (hit !== undefined) {
			return hit;
		}
		const flightKey = `${key}\u0000${version}`;
		const existing = this._inflight.get(flightKey);
		if (existing) {
			return existing;
		}
		const flight = (async () => {
			const value = await loader();
			this.set(key, value, version);
			return value;
		})();
		this._inflight.set(flightKey, flight);
		try {
			return await flight;
		} finally {
			this._inflight.delete(flightKey);
		}
	}

	private _prune(now: number): void {
		for (const [key, box] of this._entries) {
			if (now - box.storedAt >= this._ttlMs) {
				this._entries.delete(key);
			}
		}
		if (this._entries.size <= this._maxEntries) {
			return;
		}
		const byAge = Array.from(this._entries.entries()).sort(
			(a, b) => a[1].lastAccessMs - b[1].lastAccessMs,
		);
		let over = this._entries.size - this._maxEntries;
		for (const [key] of byAge) {
			if (over <= 0) {
				break;
			}
			this._entries.delete(key);
			over--;
		}
	}
}
