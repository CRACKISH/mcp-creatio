import log from '../log';

import { deriveTokenKey } from './token-crypto';

import type { UserTokens } from './session-context';

/** Idle window after which an abandoned token entry is evicted (24h), even if refreshable. */
export const TOKEN_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Where the broker keeps each user's Creatio tokens. The default {@link InMemoryTokenStore} is fine
 * for a single dev/process instance (tokens are lost on restart); {@link RedisTokenStore} makes the
 * broker stateless + horizontally scalable + restart-durable for production. Async by contract so a
 * network-backed store fits without changing callers.
 */
export interface TokenStore {
	get(userKey: string): Promise<UserTokens | null>;
	set(userKey: string, tokens: UserTokens): Promise<void>;
	delete(userKey: string): Promise<void>;
	/** Drop entries that are dead-and-non-refreshable or idle past the TTL; returns how many. A
	 *  store with native key-expiry (Redis) returns 0 here — expiry is handled on write. */
	evictStale(now: number): Promise<number>;
	close(): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
	private readonly _tokens = new Map<string, UserTokens>();

	public async get(userKey: string): Promise<UserTokens | null> {
		return this._tokens.get(userKey) ?? null;
	}

	public async set(userKey: string, tokens: UserTokens): Promise<void> {
		this._tokens.set(userKey, { ...tokens, storedAtMs: tokens.storedAtMs ?? Date.now() });
	}

	public async delete(userKey: string): Promise<void> {
		this._tokens.delete(userKey);
	}

	public async evictStale(now: number): Promise<number> {
		let removed = 0;
		for (const [userKey, tokens] of this._tokens) {
			const deadNoRefresh = now > tokens.accessTokenExpiryMs && !tokens.refreshToken;
			const abandoned = now - (tokens.storedAtMs ?? now) > TOKEN_IDLE_TTL_MS;
			if (deadNoRefresh || abandoned) {
				this._tokens.delete(userKey);
				removed++;
			}
		}
		if (removed > 0) {
			log.info('session.tokens.evicted', { removed, remaining: this._tokens.size });
		}
		return removed;
	}

	public async close(): Promise<void> {
		this._tokens.clear();
	}

	/** Test/diagnostic helper — current entry count. */
	public size(): number {
		return this._tokens.size;
	}
}

export type TokenStoreKind = 'memory' | 'redis';

export interface TokenStoreConfig {
	kind: TokenStoreKind;
	/** Redis connection URL (redis store only). */
	redisUrl?: string | undefined;
	/** Secret the at-rest encryption key is derived from (redis store only). */
	encryptionSecret?: string | undefined;
}

/**
 * Build the configured token store. Redis is imported lazily (and listed as a dependency) so a
 * memory-mode deployment never loads it. Encryption is mandatory for the Redis store.
 */
export async function createTokenStore(config: TokenStoreConfig): Promise<TokenStore> {
	if (config.kind === 'memory') {
		return new InMemoryTokenStore();
	}
	if (!config.redisUrl) {
		throw new Error('redis token store requires CREATIO_MCP_REDIS_URL');
	}
	if (!config.encryptionSecret) {
		throw new Error('redis token store requires an encryption secret (CREATIO_MCP_JWT_SECRET)');
	}
	const { RedisTokenStore } = await import('./redis-token-store.js');
	const store = new RedisTokenStore(
		config.redisUrl,
		deriveTokenKey(config.encryptionSecret),
		Math.floor(TOKEN_IDLE_TTL_MS / 1000),
	);
	await store.connect();
	return store;
}
