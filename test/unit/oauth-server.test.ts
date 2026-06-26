import crypto from 'crypto';

import { describe, expect, it } from 'vitest';

import { OAuthServer } from '../../src/server/oauth';

const challengeFor = (v: string) => crypto.createHash('sha256').update(v).digest('base64url');

function authorizedCode(server: OAuthServer, clientId: string, redirectUri: string, challenge: string) {
	// Seed a client + state the way the real flow would, then mint a code.
	server.validateAuthorizationRequest({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		state: 's',
		code_challenge: challenge,
		code_challenge_method: 'S256',
	} as never);
	return server.generateAuthorizationCode(clientId, redirectUri, challenge, 'S256', 'user-1');
}

describe('OAuthServer metadata & registration', () => {
	it('advertises the expected authorization-server metadata', () => {
		const meta = new OAuthServer('http://localhost:3000').getAuthorizationServerMetadata();
		expect(meta.issuer).toBe('http://localhost:3000');
		expect(meta.token_endpoint).toBe('http://localhost:3000/token');
		expect(meta.code_challenge_methods_supported).toContain('S256');
	});

	it('registers a client and can look it up', () => {
		const server = new OAuthServer();
		const client = server.registerClient(['http://localhost:9/cb']);
		expect(server.getClient(client.client_id)?.redirect_uris).toEqual(['http://localhost:9/cb']);
	});

	it('auto-registers an unknown client with a loopback redirect, rejects remote ones', () => {
		const server = new OAuthServer();
		expect(
			server.validateAuthorizationRequest({
				client_id: 'auto-1',
				redirect_uri: 'http://localhost:1/cb',
				response_type: 'code',
				state: 's',
				code_challenge: 'c',
				code_challenge_method: 'S256',
			} as never),
		).toBeNull();
		expect(
			server.validateAuthorizationRequest({
				client_id: 'auto-2',
				redirect_uri: 'https://evil.example.com/cb',
				response_type: 'code',
				state: 's',
				code_challenge: 'c',
				code_challenge_method: 'S256',
			} as never)?.error,
		).toBe('invalid_client');
	});
});

describe('OAuthServer state handling', () => {
	it('validates a stored state once and rejects unknown / mismatched states', () => {
		const server = new OAuthServer();
		server.storeState('st', 'client-1');
		expect(server.validateState('st', 'client-1')).toBe(true);
		expect(server.validateState('st', 'client-1')).toBe(false); // consumed
		server.storeState('st2', 'client-1');
		expect(server.validateState('st2', 'other-client')).toBe(false); // client mismatch
		expect(server.validateState('missing', 'client-1')).toBe(false);
	});
});

describe('OAuthServer token exchange', () => {
	it('exchanges a valid code for a token that validates back', async () => {
		const server = new OAuthServer();
		const verifier = 'verifier-value';
		const code = authorizedCode(server, 'client-1', 'http://localhost:1/cb', challengeFor(verifier));
		const result = await server.exchangeCodeForToken({
			grant_type: 'authorization_code',
			code,
			client_id: 'client-1',
			redirect_uri: 'http://localhost:1/cb',
			code_verifier: verifier,
		} as never);
		expect('access_token' in result).toBe(true);
		if ('access_token' in result) {
			expect(server.validateAccessToken(result.access_token)).toBe('user-1');
		}
	});

	it('rejects an unknown code and a bad grant type', async () => {
		const server = new OAuthServer();
		expect(
			(await server.exchangeCodeForToken({
				grant_type: 'authorization_code',
				code: 'nope',
				client_id: 'c',
				redirect_uri: 'http://localhost/cb',
				code_verifier: 'v',
			} as never)) as { error?: string },
		).toHaveProperty('error', 'invalid_grant');
		expect(
			(await server.exchangeCodeForToken({ grant_type: 'password' } as never)) as {
				error?: string;
			},
		).toHaveProperty('error', 'unsupported_grant_type');
	});
});
