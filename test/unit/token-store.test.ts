import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTokenStoreConfig } from '../../src/config-builder';
import { createTokenStore, InMemoryTokenStore } from '../../src/sessions/token-store';
import { decryptToken, deriveTokenKey, encryptToken } from '../../src/sessions/token-crypto';

const KEY = deriveTokenKey('a-stable-secret-of-sufficient-length-123456');

describe('token-crypto (AES-256-GCM)', () => {
	it('round-trips plaintext', () => {
		const blob = encryptToken('hello-token', KEY);
		expect(blob).not.toContain('hello-token');
		expect(decryptToken(blob, KEY)).toBe('hello-token');
	});

	it('fails to decrypt a tampered blob (GCM integrity)', () => {
		const blob = encryptToken('secret', KEY);
		const [iv, tag, ct] = blob.split('.');
		const tampered = [iv, tag, ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA')].join('.');
		expect(() => decryptToken(tampered, KEY)).toThrow();
	});

	it('fails to decrypt with the wrong key', () => {
		const blob = encryptToken('secret', KEY);
		expect(() =>
			decryptToken(blob, deriveTokenKey('different-secret-of-good-length-000000')),
		).toThrow();
	});
});

describe('InMemoryTokenStore', () => {
	const fresh = () => ({ accessToken: 'AT', accessTokenExpiryMs: Date.now() + 3_600_000 });

	it('set / get / delete', async () => {
		const s = new InMemoryTokenStore();
		await s.set('u1', fresh());
		expect((await s.get('u1'))?.accessToken).toBe('AT');
		expect((await s.get('u1'))?.storedAtMs).toBeTypeOf('number');
		await s.delete('u1');
		expect(await s.get('u1')).toBeNull();
	});

	it('evictStale removes dead-no-refresh and abandoned, keeps refreshable-fresh', async () => {
		const s = new InMemoryTokenStore();
		const now = 1_000_000_000_000;
		await s.set('dead', { accessToken: 'x', accessTokenExpiryMs: now - 1, storedAtMs: now });
		await s.set('refreshable', {
			accessToken: 'x',
			accessTokenExpiryMs: now - 1,
			refreshToken: 'RT',
			storedAtMs: now,
		});
		await s.set('abandoned', {
			accessToken: 'x',
			accessTokenExpiryMs: now + 9_000_000,
			refreshToken: 'RT',
			storedAtMs: now - 25 * 60 * 60 * 1000,
		});
		const removed = await s.evictStale(now);
		expect(removed).toBe(2); // dead + abandoned
		expect(await s.get('refreshable')).not.toBeNull();
		expect(await s.get('dead')).toBeNull();
		expect(await s.get('abandoned')).toBeNull();
	});
});

describe('createTokenStore', () => {
	it('returns an in-memory store for kind=memory', async () => {
		expect(await createTokenStore({ kind: 'memory' })).toBeInstanceOf(InMemoryTokenStore);
	});

	it('rejects redis without a URL', async () => {
		await expect(createTokenStore({ kind: 'redis', encryptionSecret: 's' })).rejects.toThrow(
			/CREATIO_MCP_REDIS_URL/,
		);
	});

	it('rejects redis without an encryption secret', async () => {
		await expect(
			createTokenStore({ kind: 'redis', redisUrl: 'redis://localhost:6379' }),
		).rejects.toThrow(/encryption secret/);
	});
});

describe('getTokenStoreConfig', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('defaults to memory', () => {
		vi.stubEnv('CREATIO_MCP_TOKEN_STORE', '');
		expect(getTokenStoreConfig()).toEqual({ kind: 'memory' });
	});

	it('reads redis url + derives encryption secret from JWT secret', () => {
		vi.stubEnv('CREATIO_MCP_TOKEN_STORE', 'redis');
		vi.stubEnv('CREATIO_MCP_REDIS_URL', 'redis://r:6379');
		vi.stubEnv('CREATIO_MCP_TOKEN_ENC_KEY', '');
		vi.stubEnv('CREATIO_MCP_JWT_SECRET', 'jwt-secret-fallback');
		expect(getTokenStoreConfig()).toEqual({
			kind: 'redis',
			redisUrl: 'redis://r:6379',
			encryptionSecret: 'jwt-secret-fallback',
		});
	});
});
