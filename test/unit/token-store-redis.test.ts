import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeRedisClient {
	public connect = vi.fn(async () => {});
	public on = vi.fn(() => this);
	public get = vi.fn(async () => null);
	public set = vi.fn(async () => 'OK');
	public del = vi.fn(async () => 1);
	public quit = vi.fn(async () => {});
}

let fakeClient: FakeRedisClient;

vi.mock('redis', () => ({
	createClient: () => fakeClient,
}));

beforeEach(() => {
	fakeClient = new FakeRedisClient();
});

describe('createTokenStore (redis success path)', () => {
	it('builds and connects a RedisTokenStore when fully configured', async () => {
		const { createTokenStore } = await import('../../src/sessions/token-store');
		const { RedisTokenStore } = await import('../../src/sessions/redis-token-store');
		const store = await createTokenStore({
			kind: 'redis',
			redisUrl: 'redis://localhost:6379',
			encryptionSecret: 'a-stable-secret-of-sufficient-length-123456',
		});
		expect(store).toBeInstanceOf(RedisTokenStore);
		expect(fakeClient.connect).toHaveBeenCalled();
	});
});
