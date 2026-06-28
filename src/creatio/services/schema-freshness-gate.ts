import { ClientCacheHashClient } from './client-cache-hash-client';

/** The ClientCache bucket that flips when the entity data model changes (add/alter/remove an
 *  entity or column). Its value = configuration hash + user culture. Watching this + `cacheVersion`
 *  is exactly what the Freedom UI does to invalidate its own runtime-entity-schema cache. */
const ENTITY_SCHEMA_HASH_NAME = 'runtime-entity-schema';

/** How long a fetched hash snapshot is trusted before we re-poll. Bounds endpoint load AND the
 *  worst-case staleness window after a data-model change. */
const DEFAULT_SNAPSHOT_TTL_MS = 60 * 1000;

/** When the endpoint is unavailable, fall back to a coarse time-bucketed token so schema caches
 *  still refresh on a fixed cadence instead of being trusted indefinitely. */
const FALLBACK_BUCKET_MS = 5 * 60 * 1000;

/**
 * Freshness policy ("thermostat") for the schema/metadata caches. It turns Creatio's client-cache
 * hashes into a per-base-url VERSION TOKEN: a schema-cache entry stamped with an older token is
 * treated as stale and refetched. This mirrors how the Freedom UI keeps its caches fresh.
 *
 * - Caches the hash snapshot per base URL for a short TTL, so we poll the endpoint at most once per
 *   ~TTL no matter how many schema reads happen.
 * - Degrades gracefully: if the endpoint is unavailable, returns a coarse time-bucketed token so
 *   caches refresh on a fallback cadence rather than going stale forever.
 * - Keyed by base URL so a multi-tenant gateway deployment never reuses tenant A's version for B.
 */
export class SchemaFreshnessGate {
	private readonly _client: ClientCacheHashClient;
	private readonly _ttlMs: number;
	private readonly _snapshots = new Map<string, { token: string; at: number }>();

	constructor(client: ClientCacheHashClient, ttlMs: number = DEFAULT_SNAPSHOT_TTL_MS) {
		this._client = client;
		this._ttlMs = ttlMs;
	}

	/**
	 * Current schema-version token for `baseUrl`. Stable while the data model is unchanged; changes
	 * when Creatio's `runtime-entity-schema` hash or the global `cacheVersion` changes. Callers stamp
	 * cached schemas with this and treat a mismatch as a miss.
	 */
	public async getSchemaVersion(baseUrl: string): Promise<string> {
		const now = Date.now();
		const cached = this._snapshots.get(baseUrl);
		if (cached && now - cached.at < this._ttlMs) {
			return cached.token;
		}
		const token = await this._fetchToken(now);
		this._snapshots.set(baseUrl, { token, at: now });
		return token;
	}

	private async _fetchToken(now: number): Promise<string> {
		const hashes = await this._client.getHashes();
		if (!hashes) {
			return `fallback:${Math.floor(now / FALLBACK_BUCKET_MS)}`;
		}
		const entitySchema = hashes.hashes[ENTITY_SCHEMA_HASH_NAME] ?? '';
		return `v${hashes.cacheVersion}:${entitySchema}`;
	}
}
