import { createClient } from 'redis';

import log from '../log';

import { decryptToken, encryptToken } from './token-crypto';

import type { UserTokens } from './session-context';
import type { TokenStore } from './token-store';
import type { RedisClientType } from 'redis';

const KEY_PREFIX = 'mcp:creatio:tok:';

/**
 * Redis-backed broker token store: stateless + restart-durable + multi-instance safe. Tokens are
 * AES-256-GCM encrypted at rest; per-key TTL (reset on every write) handles idle eviction natively,
 * so {@link evictStale} is a no-op. Lazy-loaded by {@link createTokenStore} so memory-mode never
 * touches the `redis` dependency.
 */
export class RedisTokenStore implements TokenStore {
	private readonly _client: RedisClientType;

	constructor(
		url: string,
		private readonly _key: Buffer,
		private readonly _ttlSeconds: number,
	) {
		this._client = createClient({ url });
		this._client.on('error', (err) => log.warn('redis.client.error', { error: String(err) }));
	}

	private _redisKey(userKey: string): string {
		return `${KEY_PREFIX}${userKey}`;
	}

	public async connect(): Promise<void> {
		await this._client.connect();
		log.info('redis.token_store.connected', {});
	}

	public async get(userKey: string): Promise<UserTokens | null> {
		const blob = await this._client.get(this._redisKey(userKey));
		if (!blob) {
			return null;
		}
		try {
			return JSON.parse(decryptToken(blob, this._key)) as UserTokens;
		} catch (err) {
			// A corrupt/undecryptable entry (e.g. rotated key) is treated as absent so the user
			// simply re-authorizes, rather than wedging on a bad blob.
			log.warn('redis.token_store.decrypt_failed', { error: String(err) });
			return null;
		}
	}

	public async set(userKey: string, tokens: UserTokens): Promise<void> {
		const payload: UserTokens = { ...tokens, storedAtMs: tokens.storedAtMs ?? Date.now() };
		const blob = encryptToken(JSON.stringify(payload), this._key);
		await this._client.set(this._redisKey(userKey), blob, { EX: this._ttlSeconds });
	}

	public async delete(userKey: string): Promise<void> {
		await this._client.del(this._redisKey(userKey));
	}

	public async evictStale(): Promise<number> {
		return 0; // Redis expires keys natively via the per-write TTL.
	}

	public async close(): Promise<void> {
		try {
			await this._client.quit();
		} catch (err) {
			log.warn('redis.token_store.close_failed', { error: String(err) });
		}
	}
}
