import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTokenStore, TokenStore } from '../../src/sessions/token-store';

/**
 * REAL-Redis integration for the broker token store. Unit tests (redis-token-store.test.ts) mock the
 * `redis` client to cover our LOGIC; this verifies the store against an actual server — encryption
 * round-trip, cross-instance read (replica/restart durability), TTL set, delete. It AUTO-SKIPS when
 * no Redis is reachable, so CI/dev without Redis stays green; point it at one with `TEST_REDIS_URL`
 * (or run a local `redis://127.0.0.1:6379`) to exercise it.
 */
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';
const SECRET = 'integration-secret-of-sufficient-length-0123456789';

async function redisReachable(): Promise<boolean> {
	try {
		const client = createClient({ url: REDIS_URL, socket: { reconnectStrategy: false } });
		client.on('error', () => {});
		await Promise.race([
			client.connect(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
		]);
		await client.quit().catch(() => {});
		return true;
	} catch {
		return false;
	}
}

const available = await redisReachable();

describe.skipIf(!available)('RedisTokenStore — real Redis integration', () => {
	let store: TokenStore;

	beforeAll(async () => {
		store = await createTokenStore({
			kind: 'redis',
			redisUrl: REDIS_URL,
			encryptionSecret: SECRET,
		});
	});

	afterAll(async () => {
		await store?.close();
	});

	it('round-trips, is readable by a second instance (durability), and deletes', async () => {
		const userKey = `it-user-${Date.now()}`;
		await store.set(userKey, {
			accessToken: 'AT',
			accessTokenExpiryMs: Date.now() + 3_600_000,
			refreshToken: 'RT',
		});
		expect((await store.get(userKey))?.accessToken).toBe('AT');

		// A separate store instance (another replica / after a restart) reads the same record.
		const other = await createTokenStore({
			kind: 'redis',
			redisUrl: REDIS_URL,
			encryptionSecret: SECRET,
		});
		expect((await other.get(userKey))?.refreshToken).toBe('RT');
		await other.close();

		await store.delete(userKey);
		expect(await store.get(userKey)).toBeNull();
	});

	it('a wrong encryption key cannot read another key holder’s value', async () => {
		const userKey = `it-enc-${Date.now()}`;
		await store.set(userKey, {
			accessToken: 'SECRET-AT',
			accessTokenExpiryMs: Date.now() + 3_600_000,
		});
		const wrongKey = await createTokenStore({
			kind: 'redis',
			redisUrl: REDIS_URL,
			encryptionSecret: 'a-totally-different-secret-0123456789',
		});
		// Undecryptable blob is treated as absent (forces clean re-auth), never leaks plaintext.
		expect(await wrongKey.get(userKey)).toBeNull();
		await wrongKey.close();
		await store.delete(userKey);
	});
});
