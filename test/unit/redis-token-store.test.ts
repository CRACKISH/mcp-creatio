import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveTokenKey } from '../../src/sessions/token-crypto';

import type { UserTokens } from '../../src/sessions/session-context';

/** In-memory Map-backed stand-in for a redis client. */
class FakeRedisClient {
	public store = new Map<string, string>();
	public connected = false;
	public quitCalled = false;
	public connect = vi.fn(async () => {
		this.connected = true;
	});
	public on = vi.fn(() => this);
	public get = vi.fn(async (key: string) => this.store.get(key) ?? null);
	public set = vi.fn(async (key: string, value: string) => {
		this.store.set(key, value);
		return 'OK';
	});
	public del = vi.fn(async (key: string) => {
		this.store.delete(key);
		return 1;
	});
	public quit = vi.fn(async () => {
		this.quitCalled = true;
	});
}

let fakeClient: FakeRedisClient;

vi.mock('redis', () => ({
	createClient: () => fakeClient,
}));

const KEY = deriveTokenKey('a-stable-secret-of-sufficient-length-123456');

async function makeStore() {
	const { RedisTokenStore } = await import('../../src/sessions/redis-token-store');
	const store = new RedisTokenStore('redis://localhost:6379', KEY, 3600);
	await store.connect();
	return store;
}

beforeEach(() => {
	fakeClient = new FakeRedisClient();
});

describe('RedisTokenStore', () => {
	const tokens: UserTokens = { accessToken: 'AT', accessTokenExpiryMs: Date.now() + 3_600_000 };

	it('connects via the mocked client', async () => {
		await makeStore();
		expect(fakeClient.connect).toHaveBeenCalled();
		expect(fakeClient.connected).toBe(true);
	});

	it('set → get round-trips UserTokens and stores them encrypted at rest', async () => {
		const store = await makeStore();
		await store.set('u1', tokens);
		// On-disk value must be encrypted — not the plaintext access token.
		const raw = [...fakeClient.store.values()][0];
		expect(raw).toBeTruthy();
		expect(raw).not.toContain('AT');
		const back = await store.get('u1');
		expect(back?.accessToken).toBe('AT');
		expect(back?.storedAtMs).toBeTypeOf('number');
	});

	it('get of an absent key returns null', async () => {
		const store = await makeStore();
		expect(await store.get('missing')).toBeNull();
	});

	it('delete removes the entry', async () => {
		const store = await makeStore();
		await store.set('u1', tokens);
		await store.delete('u1');
		expect(await store.get('u1')).toBeNull();
		expect(fakeClient.del).toHaveBeenCalled();
	});

	it('get of a corrupt/undecryptable blob returns null', async () => {
		const store = await makeStore();
		// Inject a value the prefixed key would resolve to, but not valid ciphertext.
		const key = [...fakeClient.store.keys()][0] ?? 'mcp:creatio:tok:bad';
		fakeClient.store.set('mcp:creatio:tok:bad', 'not-a-valid-encrypted-blob');
		void key;
		expect(await store.get('bad')).toBeNull();
	});

	it('evictStale is a no-op returning 0 (native TTL)', async () => {
		const store = await makeStore();
		expect(await store.evictStale(Date.now())).toBe(0);
	});

	it('close calls quit', async () => {
		const store = await makeStore();
		await store.close();
		expect(fakeClient.quit).toHaveBeenCalled();
		expect(fakeClient.quitCalled).toBe(true);
	});

	it('close swallows a quit failure', async () => {
		const store = await makeStore();
		fakeClient.quit.mockRejectedValueOnce(new Error('boom'));
		await expect(store.close()).resolves.toBeUndefined();
	});
});
