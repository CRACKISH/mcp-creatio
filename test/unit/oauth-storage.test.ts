import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthStorage } from '../../src/server/oauth/storage';

import type { OAuthClient } from '../../src/server/oauth/types';

function client(id: string, createdAt = Date.now()): OAuthClient {
	return {
		client_id: id,
		redirect_uris: ['http://localhost:1/cb'],
		grant_types: ['authorization_code'],
		created_at: createdAt,
	};
}

afterEach(() => vi.useRealTimers());

describe('OAuthStorage clients', () => {
	it('add / get / has', () => {
		const s = new OAuthStorage();
		expect(s.hasClient('c1')).toBe(false);
		s.addClient(client('c1'));
		expect(s.hasClient('c1')).toBe(true);
		expect(s.getClient('c1')?.client_id).toBe('c1');
		expect(s.getClient('missing')).toBeUndefined();
	});
});

describe('OAuthStorage authorization codes', () => {
	it('store / get / delete', () => {
		const s = new OAuthStorage();
		s.storeAuthorizationCode('code1', 'c1', 'http://localhost:1/cb', 'chal', 'S256', 'u1');
		const data = s.getAuthorizationCode('code1');
		expect(data?.client_id).toBe('c1');
		expect(data?.userKey).toBe('u1');
		s.deleteAuthorizationCode('code1');
		expect(s.getAuthorizationCode('code1')).toBeUndefined();
	});
});

describe('OAuthStorage pending authorizations', () => {
	const pending = {
		client_id: 'c1',
		redirect_uri: 'http://localhost:1/cb',
		code_challenge: 'chal',
		code_challenge_method: 'S256',
		creatio_verifier: 'verifier',
	};

	it('take is single-use', () => {
		const s = new OAuthStorage();
		s.storePendingAuthorization('state1', pending);
		expect(s.takePendingAuthorization('state1')?.client_id).toBe('c1');
		// Removed after first take.
		expect(s.takePendingAuthorization('state1')).toBeUndefined();
	});

	it('returns undefined for an unknown state', () => {
		expect(new OAuthStorage().takePendingAuthorization('nope')).toBeUndefined();
	});

	it('returns undefined once expired', () => {
		const s = new OAuthStorage();
		s.storePendingAuthorization('state1', pending, -1); // already expired
		expect(s.takePendingAuthorization('state1')).toBeUndefined();
	});
});

describe('OAuthStorage refresh tokens', () => {
	it('store / get / delete', () => {
		const s = new OAuthStorage();
		s.storeRefreshToken('rt1', 'u1', 'c1');
		expect(s.getRefreshToken('rt1')?.userKey).toBe('u1');
		s.deleteRefreshToken('rt1');
		expect(s.getRefreshToken('rt1')).toBeUndefined();
	});

	it('get of an unknown token is undefined', () => {
		expect(new OAuthStorage().getRefreshToken('nope')).toBeUndefined();
	});

	it('expired token is pruned on get', () => {
		const s = new OAuthStorage();
		s.storeRefreshToken('rt1', 'u1', 'c1', -1);
		expect(s.getRefreshToken('rt1')).toBeUndefined();
		// Pruned, so a second get also misses (no longer present).
		expect(s.getRefreshToken('rt1')).toBeUndefined();
	});

	it('deleteRefreshTokensForUser drops only that user', () => {
		const s = new OAuthStorage();
		s.storeRefreshToken('rt1', 'u1', 'c1');
		s.storeRefreshToken('rt2', 'u1', 'c2');
		s.storeRefreshToken('rt3', 'u2', 'c1');
		s.deleteRefreshTokensForUser('u1');
		expect(s.getRefreshToken('rt1')).toBeUndefined();
		expect(s.getRefreshToken('rt2')).toBeUndefined();
		expect(s.getRefreshToken('rt3')?.userKey).toBe('u2');
	});
});

describe('OAuthStorage.cleanup', () => {
	it('evicts expired codes, pending auths and refresh tokens', () => {
		const s = new OAuthStorage();
		s.storeAuthorizationCode('c-expired', 'c1', 'http://localhost:1/cb', 'x', 'S256', 'u', -1);
		s.storeAuthorizationCode('c-live', 'c1', 'http://localhost:1/cb', 'x', 'S256', 'u', 60_000);
		s.storePendingAuthorization(
			'p-expired',
			{
				client_id: 'c1',
				redirect_uri: 'http://localhost:1/cb',
				code_challenge: 'x',
				code_challenge_method: 'S256',
				creatio_verifier: 'v',
			},
			-1,
		);
		s.storeRefreshToken('rt-expired', 'u', 'c1', -1);
		s.storeRefreshToken('rt-live', 'u', 'c1', 60_000);
		s.addClient(client('c1'));
		s.cleanup();
		expect(s.getAuthorizationCode('c-expired')).toBeUndefined();
		expect(s.getAuthorizationCode('c-live')).toBeDefined();
		expect(s.getRefreshToken('rt-expired')).toBeUndefined();
		expect(s.getRefreshToken('rt-live')).toBeDefined();
		// Live client (created now) survives the TTL sweep.
		expect(s.hasClient('c1')).toBe(true);
	});

	it('evicts clients older than the TTL', () => {
		vi.useFakeTimers();
		const now = 10_000_000_000_000;
		vi.setSystemTime(now);
		const s = new OAuthStorage();
		// Created just over 24h ago.
		s.addClient(client('old', now - (24 * 60 * 60 * 1000 + 1)));
		s.addClient(client('fresh', now));
		s.cleanup();
		expect(s.hasClient('old')).toBe(false);
		expect(s.hasClient('fresh')).toBe(true);
	});

	it('caps the client store at MAX_CLIENTS, evicting oldest first', () => {
		const s = new OAuthStorage();
		// Insert MAX_CLIENTS + 5 = 1005; the 5 oldest are evicted on each add past the cap.
		for (let i = 0; i < 1005; i++) {
			s.addClient(client(`c${i}`));
		}
		// First-inserted ones are gone, latest remain.
		expect(s.hasClient('c0')).toBe(false);
		expect(s.hasClient('c4')).toBe(false);
		expect(s.hasClient('c1004')).toBe(true);
	});
});
