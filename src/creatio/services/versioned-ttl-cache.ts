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
