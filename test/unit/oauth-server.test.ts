import { describe, expect, it } from 'vitest';

import { OAuthServer } from '../../src/server/oauth/oauth-server';

import type { TokenAudience } from '../../src/server/oauth/token-manager';
import type { OAuthAccessToken } from '../../src/server/oauth/types';

const AUD: TokenAudience = { issuer: 'https://mcp.local', audience: 'https://mcp.local/mcp' };
const REDIRECT = 'http://localhost:9999/cb';

function isToken(r: OAuthAccessToken | { error: string }): r is OAuthAccessToken {
	return !('error' in r);
}

describe('OAuthServer.validateAuthorizationRequest auto-register', () => {
	it('auto-registers an unknown client with an allowed redirect, then validates', () => {
		const server = new OAuthServer('a-secret');
		const err = server.validateAuthorizationRequest({
			client_id: 'vscode-x',
			redirect_uri: REDIRECT,
			response_type: 'code',
			code_challenge: 'chal',
			code_challenge_method: 'S256',
		});
		expect(err).toBeNull();
	});

	it('refuses to auto-register against a disallowed (remote) redirect', () => {
		const server = new OAuthServer('a-secret');
		const err = server.validateAuthorizationRequest({
			client_id: 'attacker',
			redirect_uri: 'https://evil.example.com/cb',
			response_type: 'code',
			code_challenge: 'chal',
			code_challenge_method: 'S256',
		});
		// No client was registered → invalid_client.
		expect(err?.error).toBe('invalid_client');
	});
});

// RFC 7636 known verifier/challenge pair — lets us pass real PKCE on the token exchange.
const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function issueRealTokens(server: OAuthServer, userKey: string) {
	const client = server.registerClient([REDIRECT]);
	const code = server.generateAuthorizationCode(
		client.client_id,
		REDIRECT,
		PKCE_CHALLENGE,
		'S256',
		userKey,
	);
	const result = await server.exchangeCodeForToken(
		{
			grant_type: 'authorization_code',
			client_id: client.client_id,
			redirect_uri: REDIRECT,
			code,
			code_verifier: PKCE_VERIFIER,
		},
		AUD,
	);
	if (!isToken(result)) throw new Error('expected token');
	return { client, result };
}

describe('OAuthServer.resolveUserFromToken', () => {
	it('resolves a user from a valid access JWT and from an issued refresh token', async () => {
		const server = new OAuthServer('a-secret');
		const { result } = await issueRealTokens(server, 'refresh-user');
		expect(server.resolveUserFromToken(result.access_token, AUD)).toBe('refresh-user');
		expect(server.resolveUserFromToken(result.refresh_token!, AUD)).toBe('refresh-user');
	});

	it('returns null for an unknown token', () => {
		const server = new OAuthServer('a-secret');
		expect(server.resolveUserFromToken('garbage-token', AUD)).toBeNull();
	});
});

describe('OAuthServer.exchangeRefreshToken', () => {
	const held = async () => true;

	it('rejects an invalid/unknown refresh token', async () => {
		const server = new OAuthServer('a-secret');
		const r = await server.exchangeRefreshToken(
			{ grant_type: 'refresh_token', client_id: 'c1', refresh_token: 'nope' },
			AUD,
			held,
		);
		expect('error' in r && r.error).toBe('invalid_grant');
	});

	it('rejects a missing refresh_token (validation)', async () => {
		const server = new OAuthServer('a-secret');
		const r = await server.exchangeRefreshToken(
			{ grant_type: 'refresh_token', client_id: 'c1' },
			AUD,
			held,
		);
		expect('error' in r && r.error).toBe('invalid_request');
	});

	it('rejects when a different client presents the refresh token', async () => {
		const server = new OAuthServer('a-secret');
		const { result } = await issueRealTokens(server, 'u-1');
		const r = await server.exchangeRefreshToken(
			{
				grant_type: 'refresh_token',
				client_id: 'different-client',
				refresh_token: result.refresh_token!,
			},
			AUD,
			held,
		);
		expect('error' in r && r.error_description).toBe('Client mismatch');
	});

	it('rejects when the session is no longer held', async () => {
		const server = new OAuthServer('a-secret');
		const { client, result } = await issueRealTokens(server, 'u-1');
		const r = await server.exchangeRefreshToken(
			{
				grant_type: 'refresh_token',
				client_id: client.client_id,
				refresh_token: result.refresh_token!,
			},
			AUD,
			async () => false,
		);
		expect('error' in r && r.error_description).toMatch(/re-authorization required/i);
	});

	it('rotates and re-issues while the session is held', async () => {
		const server = new OAuthServer('a-secret');
		const { client, result } = await issueRealTokens(server, 'u-1');
		const r = await server.exchangeRefreshToken(
			{
				grant_type: 'refresh_token',
				client_id: client.client_id,
				refresh_token: result.refresh_token!,
			},
			AUD,
			held,
		);
		expect(isToken(r)).toBe(true);
		if (isToken(r)) {
			expect(r.refresh_token).not.toBe(result.refresh_token);
		}
	});
});

describe('OAuthServer.purgeRefreshTokensForUser', () => {
	it('invalidates a previously issued refresh token', async () => {
		const server = new OAuthServer('a-secret');
		const { result } = await issueRealTokens(server, 'purge-user');
		expect(server.resolveUserFromToken(result.refresh_token!, AUD)).toBe('purge-user');
		server.purgeRefreshTokensForUser('purge-user');
		expect(server.resolveUserFromToken(result.refresh_token!, AUD)).toBeNull();
	});
});

describe('OAuthServer.cleanup', () => {
	it('runs without throwing', () => {
		expect(() => new OAuthServer('a-secret').cleanup()).not.toThrow();
	});
});
