import crypto from 'crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OAuthClientManager } from '../../src/server/oauth/client-manager';
import { OAuthStorage } from '../../src/server/oauth/storage';
import { OAuthTokenManager } from '../../src/server/oauth/token-manager';

import type { AuthorizationCodeData } from '../../src/server/oauth/storage';

const challengeFor = (verifier: string) =>
	crypto.createHash('sha256').update(verifier).digest('base64url');

describe('OAuthTokenManager', () => {
	it('signs an access token that validates back to the userKey', () => {
		const tm = new OAuthTokenManager('secret');
		const token = tm.generateAccessToken('user-1', 'client-1');
		expect(tm.validateAccessToken(token)).toBe('user-1');
	});

	it('rejects a token signed with a different secret', () => {
		const token = new OAuthTokenManager('secret-a').generateAccessToken('u', 'c');
		expect(new OAuthTokenManager('secret-b').validateAccessToken(token)).toBeNull();
		expect(new OAuthTokenManager('secret-a').validateAccessToken('garbage')).toBeNull();
	});

	it('verifies PKCE S256', () => {
		const tm = new OAuthTokenManager('s');
		const verifier = 'a-verifier-string';
		expect(tm.verifyPKCE(verifier, challengeFor(verifier))).toBe(true);
		expect(tm.verifyPKCE(verifier, challengeFor('different'))).toBe(false);
	});

	it('validates authorization-code data against the token request', () => {
		const tm = new OAuthTokenManager('s');
		const verifier = 'verifier';
		const base: AuthorizationCodeData = {
			client_id: 'c',
			redirect_uri: 'http://localhost/cb',
			code_challenge: challengeFor(verifier),
			code_challenge_method: 'S256',
			userKey: 'u',
			expires_at: Date.now() + 60_000,
		};
		const goodReq = {
			grant_type: 'authorization_code',
			code: 'x',
			client_id: 'c',
			redirect_uri: 'http://localhost/cb',
			code_verifier: verifier,
		} as never;
		expect(tm.validateAuthCodeData(base, goodReq)).toBeNull();

		expect(
			tm.validateAuthCodeData({ ...base, expires_at: Date.now() - 1 }, goodReq)?.error,
		).toBe('invalid_grant');
		expect(
			tm.validateAuthCodeData({ ...base, client_id: 'other' }, goodReq)?.error_description,
		).toMatch(/Client mismatch/);
		expect(
			tm.validateAuthCodeData(
				{ ...base, redirect_uri: 'http://localhost/evil' },
				goodReq,
			)?.error_description,
		).toMatch(/Redirect URI mismatch/);
		expect(
			tm.validateAuthCodeData(base, { ...goodReq, code_verifier: undefined } as never)
				?.error_description,
		).toMatch(/Missing code_verifier/);
		expect(
			tm.validateAuthCodeData(base, { ...goodReq, code_verifier: 'wrong' } as never)
				?.error_description,
		).toMatch(/PKCE verification failed/);
	});
});

describe('OAuthStorage', () => {
	afterEach(() => vi.useRealTimers());

	it('stores and retrieves authorization codes and states', () => {
		const s = new OAuthStorage();
		s.storeAuthorizationCode('code', 'c', 'http://localhost/cb', 'chal', 'S256', 'u');
		expect(s.getAuthorizationCode('code')?.userKey).toBe('u');
		s.deleteAuthorizationCode('code');
		expect(s.getAuthorizationCode('code')).toBeUndefined();

		s.storeState('st', 'c');
		expect(s.getState('st')?.client_id).toBe('c');
		s.deleteState('st');
		expect(s.getState('st')).toBeUndefined();
	});

	it('cleanup evicts only expired codes and states', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const s = new OAuthStorage();
		s.storeAuthorizationCode('old', 'c', 'u', 'chal', 'S256', 'u', 1000);
		s.storeAuthorizationCode('fresh', 'c', 'u', 'chal', 'S256', 'u', 60 * 60 * 1000);
		s.storeState('old-state', 'c', 1000);
		vi.setSystemTime(5000);
		s.cleanup();
		expect(s.getAuthorizationCode('old')).toBeUndefined();
		expect(s.getAuthorizationCode('fresh')).toBeDefined();
		expect(s.getState('old-state')).toBeUndefined();
	});
});

describe('OAuthClientManager', () => {
	it('auto-registers a public client with the supplied redirect URI', () => {
		const client = OAuthClientManager.autoRegisterClient('claude-x', 'http://localhost:1/cb');
		expect(client.client_id).toBe('claude-x');
		expect(client.redirect_uris).toEqual(['http://localhost:1/cb']);
		expect(client.token_endpoint_auth_method).toBe('none');
	});

	it('labels known MCP clients by client_id substring', () => {
		// Exercises the name-detection branches; all stay public clients.
		for (const id of ['claude-desktop', 'vscode-ext', 'cursor-app', 'something-else']) {
			const client = OAuthClientManager.autoRegisterClient(id, 'http://localhost:1/cb');
			expect(client.client_id).toBe(id);
			expect(client.token_endpoint_auth_method).toBe('none');
		}
	});

	it('creates a client with a generated id', () => {
		const client = OAuthClientManager.createClient(['http://localhost:2/cb']);
		expect(client.client_id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(client.redirect_uris).toEqual(['http://localhost:2/cb']);
	});
});
