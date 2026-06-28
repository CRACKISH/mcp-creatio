import { describe, expect, it } from 'vitest';

import { OAuthValidators } from '../../src/server/oauth/validators';

import type {
	OAuthAuthorizationRequest,
	OAuthClient,
	OAuthTokenRequest,
} from '../../src/server/oauth/types';

function client(overrides: Partial<OAuthClient> = {}): OAuthClient {
	return {
		client_id: 'c1',
		redirect_uris: ['http://localhost:9999/cb'],
		grant_types: ['authorization_code', 'refresh_token'],
		response_types: ['code'],
		token_endpoint_auth_method: 'none',
		created_at: Date.now(),
		...overrides,
	};
}

describe('OAuthValidators.isAllowedRedirectUri', () => {
	it('allows loopback http/https', () => {
		expect(OAuthValidators.isAllowedRedirectUri('http://localhost:9999/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('http://127.0.0.1/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('https://localhost/cb')).toBe(true);
	});

	it('rejects remote http/https', () => {
		expect(OAuthValidators.isAllowedRedirectUri('http://evil.example.com/cb')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('https://remote.host/cb')).toBe(false);
	});

	it('allows custom app schemes (deep links)', () => {
		expect(OAuthValidators.isAllowedRedirectUri('com.example.app:/oauth')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('vscode://callback')).toBe(true);
	});

	it('rejects dangerous schemes', () => {
		expect(OAuthValidators.isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('data:text/html,x')).toBe(false);
	});

	it('rejects malformed URIs', () => {
		expect(OAuthValidators.isAllowedRedirectUri('not a url')).toBe(false);
	});
});

describe('OAuthValidators.validateAuthorizationRequest', () => {
	const base: OAuthAuthorizationRequest = {
		client_id: 'c1',
		redirect_uri: 'http://localhost:9999/cb',
		response_type: 'code',
		code_challenge: 'abc',
		code_challenge_method: 'S256',
	};

	it('rejects when client is missing', () => {
		expect(OAuthValidators.validateAuthorizationRequest(base, undefined)?.error).toBe(
			'invalid_client',
		);
	});

	it('rejects a redirect_uri not registered for the client', () => {
		const err = OAuthValidators.validateAuthorizationRequest(
			{ ...base, redirect_uri: 'http://localhost:1/other' },
			client(),
		);
		expect(err?.error).toBe('invalid_request');
		expect(err?.error_description).toBe('Invalid redirect_uri');
	});

	it('rejects a non-code response_type', () => {
		expect(
			OAuthValidators.validateAuthorizationRequest(
				{ ...base, response_type: 'token' },
				client(),
			)?.error,
		).toBe('unsupported_response_type');
	});

	it('rejects missing PKCE', () => {
		expect(
			OAuthValidators.validateAuthorizationRequest({ ...base, code_challenge: '' }, client())
				?.error,
		).toBe('invalid_request');
	});

	it('rejects a non-S256 PKCE method', () => {
		expect(
			OAuthValidators.validateAuthorizationRequest(
				{ ...base, code_challenge_method: 'plain' },
				client(),
			)?.error,
		).toBe('invalid_request');
	});

	it('passes a well-formed request', () => {
		expect(OAuthValidators.validateAuthorizationRequest(base, client())).toBeNull();
	});
});

describe('OAuthValidators.validateTokenRequest', () => {
	it('authorization_code requires code + verifier', () => {
		const err = OAuthValidators.validateTokenRequest({
			grant_type: 'authorization_code',
			client_id: 'c1',
		} as OAuthTokenRequest);
		expect(err?.error).toBe('invalid_request');
	});

	it('authorization_code passes with code + verifier', () => {
		expect(
			OAuthValidators.validateTokenRequest({
				grant_type: 'authorization_code',
				client_id: 'c1',
				code: 'x',
				code_verifier: 'v',
			}),
		).toBeNull();
	});

	it('refresh_token requires the token', () => {
		expect(
			OAuthValidators.validateTokenRequest({
				grant_type: 'refresh_token',
				client_id: 'c1',
			})?.error,
		).toBe('invalid_request');
	});

	it('refresh_token passes with a token', () => {
		expect(
			OAuthValidators.validateTokenRequest({
				grant_type: 'refresh_token',
				client_id: 'c1',
				refresh_token: 'rt',
			}),
		).toBeNull();
	});

	it('rejects an unsupported grant', () => {
		expect(
			OAuthValidators.validateTokenRequest({
				grant_type: 'client_credentials',
				client_id: 'c1',
			})?.error,
		).toBe('unsupported_grant_type');
	});
});

describe('OAuthValidators.validateClientRegistration', () => {
	it('rejects a non-array', () => {
		expect(OAuthValidators.validateClientRegistration('x')).toMatch(/must be an array/);
		expect(OAuthValidators.validateClientRegistration(undefined)).toMatch(/must be an array/);
	});

	it('rejects an empty array', () => {
		expect(OAuthValidators.validateClientRegistration([])).toMatch(/at least one/);
	});

	it('rejects a non-string entry', () => {
		expect(OAuthValidators.validateClientRegistration([123])).toMatch(/must be strings/);
	});

	it('rejects a bad URL', () => {
		expect(OAuthValidators.validateClientRegistration(['nope'])).toMatch(
			/Invalid redirect_uri/,
		);
	});

	it('rejects a disallowed (remote) redirect', () => {
		expect(OAuthValidators.validateClientRegistration(['https://evil.com/cb'])).toMatch(
			/Disallowed/,
		);
	});

	it('passes loopback redirects', () => {
		expect(OAuthValidators.validateClientRegistration(['http://localhost:9999/cb'])).toBeNull();
	});
});
