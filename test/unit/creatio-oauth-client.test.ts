import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { CreatioOAuthClient } from '../../src/creatio/auth/providers/creatio-oauth-client';

function publicAuth(extra: Record<string, unknown> = {}) {
	return {
		kind: AuthProviderType.Broker,
		clientId: 'app-1',
		jwtSecret: 'jwt',
		...extra,
	} as never;
}
function jsonOk(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

const BASE = 'https://t.creatio.local';

afterEach(() => vi.unstubAllGlobals());

describe('CreatioOAuthClient.buildAuthorizeUrl', () => {
	it('builds the Creatio authorize URL with S256 PKCE + scope', () => {
		const url = new URL(
			new CreatioOAuthClient(BASE, publicAuth()).buildAuthorizeUrl(
				'http://localhost:3000/oauth/callback',
				'BROKER-STATE',
				'CHALLENGE',
			),
		);
		expect(url.pathname).toContain('/0/connect/authorize');
		expect(url.searchParams.get('client_id')).toBe('app-1');
		expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/oauth/callback');
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('state')).toBe('BROKER-STATE');
		expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('scope')).toBe('offline_access');
	});
});

describe('CreatioOAuthClient.exchangeCode', () => {
	it('sends authorization_code + code_verifier and parses tokens (public client: no secret)', async () => {
		let body = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_u: string, init: RequestInit) => {
				body = String(init.body);
				return jsonOk({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
			}),
		);
		const tokens = await new CreatioOAuthClient(BASE, publicAuth()).exchangeCode(
			'CODE',
			'http://localhost:3000/oauth/callback',
			'VERIFIER',
		);
		const p = new URLSearchParams(body);
		expect(p.get('grant_type')).toBe('authorization_code');
		expect(p.get('code')).toBe('CODE');
		expect(p.get('code_verifier')).toBe('VERIFIER');
		expect(p.get('client_secret')).toBeNull();
		expect(tokens).toMatchObject({ accessToken: 'AT', refreshToken: 'RT' });
		expect(tokens.accessTokenExpiryMs).toBeGreaterThan(Date.now());
	});

	it('includes client_secret for a confidential client', async () => {
		let body = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_u: string, init: RequestInit) => {
				body = String(init.body);
				return jsonOk({ access_token: 'AT', expires_in: 3600 });
			}),
		);
		await new CreatioOAuthClient(BASE, publicAuth({ clientSecret: 'sek' })).exchangeCode(
			'C',
			'http://localhost:3000/oauth/callback',
			'V',
		);
		expect(new URLSearchParams(body).get('client_secret')).toBe('sek');
	});

	it('throws on a non-OK token response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 400 })),
		);
		await expect(
			new CreatioOAuthClient(BASE, publicAuth()).exchangeCode(
				'C',
				'http://localhost:3000/oauth/callback',
				'V',
			),
		).rejects.toThrow(/creatio_oauth_exchange_error/);
	});
});

describe('CreatioOAuthClient.refresh', () => {
	it('keeps the previous refresh token when Creatio returns none', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonOk({ access_token: 'AT2', expires_in: 3600 })),
		);
		const tokens = await new CreatioOAuthClient(BASE, publicAuth()).refresh('OLD-RT');
		expect(tokens.accessToken).toBe('AT2');
		expect(tokens.refreshToken).toBe('OLD-RT');
	});

	it('adopts a rotated refresh token when returned', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({ access_token: 'AT2', refresh_token: 'NEW-RT', expires_in: 3600 }),
			),
		);
		const tokens = await new CreatioOAuthClient(BASE, publicAuth()).refresh('OLD-RT');
		expect(tokens.refreshToken).toBe('NEW-RT');
	});
});
