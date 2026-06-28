import log from '../../log';

import { CreatioHttpClient } from './http-client';

/** Parsed `/api/ClientCache/Hashes` response: the global cache version + a name→hash map. */
export interface ClientCacheHashes {
	/** SysSetting `ClientCacheVersion` — a manual global bump that force-busts every client cache. */
	cacheVersion: number;
	/** Per-cache content hashes keyed by cache name (e.g. `runtime-entity-schema`). */
	hashes: Record<string, string>;
}

/**
 * Thin transport for Creatio's client-cache hash endpoint (`GET /0/api/ClientCache/Hashes`) — the
 * same stamp the Freedom UI polls to learn when its cached schemas/settings went stale (see core
 * `ClientCacheController` + `CacheHashBuilder`). Pure transport: it fetches and shapes the
 * response and NEVER throws (returns `null` on any failure) so the freshness policy can degrade
 * gracefully. It knows nothing about WHAT we cache or WHEN to invalidate — that is the gate's job.
 */
export class ClientCacheHashClient {
	private readonly _client: CreatioHttpClient;

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _url(): string {
		// `/api/…` (not `/rest/…`), under the same `/0` workspace prefix the rest of our calls use.
		return `${this._client.normalizedBaseUrl}/0/api/ClientCache/Hashes`;
	}

	public async getHashes(): Promise<ClientCacheHashes | null> {
		const url = this._url();
		try {
			const headers = await this._client.getJsonHeaders();
			const response = await this._client.fetchWithAuth(url, async () => ({ headers }));
			if (!response.ok) {
				log.warn('creatio.client_cache.hashes.not_ok', { url, status: response.status });
				return null;
			}
			const body: any = await response.json().catch(() => null);
			if (!body || !Array.isArray(body.hashes)) {
				return null;
			}
			const hashes: Record<string, string> = {};
			for (const entry of body.hashes) {
				if (entry && typeof entry.name === 'string') {
					hashes[entry.name] = String(entry.value ?? '');
				}
			}
			const parsedVersion = Number(body.cacheVersion);
			return {
				cacheVersion: Number.isFinite(parsedVersion) ? parsedVersion : 0,
				hashes,
			};
		} catch (err) {
			log.warn('creatio.client_cache.hashes.failed', { url, error: String(err) });
			return null;
		}
	}
}
