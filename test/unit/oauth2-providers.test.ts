import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { OAuth2Provider } from '../../src/creatio/auth/providers/oauth2-provider';

function ccConfig() {
	return {
		baseUrl: 'https://tenant.creatio.local',
		auth: { kind: AuthProviderType.OAuth2, clientId: 'client-1', clientSecret: 'secret' },
	};
}

function jsonOk(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('OAuth2Provider (client credentials)', () => {
	it('fetches and caches an app-level token', async () => {
		const fetchMock = vi.fn(async () => jsonOk({ access_token: 'CC', expires_in: 3600 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2Provider(ccConfig() as never);
		const headers = await provider.getHeaders('application/json', true);
		expect(headers.Authorization).toBe('Bearer CC');
		await provider.getHeaders('application/json', true);
		expect(fetchMock).toHaveBeenCalledTimes(1); // cached
	});

	it('throws the auth-failed error when the token endpoint fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 401 })),
		);
		const provider = new OAuth2Provider(ccConfig() as never);
		await expect(provider.getHeaders('application/json', true)).rejects.toThrow(
			/oauth2_auth_failed/,
		);
	});

	it.each([
		['an empty body', () => new Response('', { status: 200 })],
		['invalid JSON', () => new Response('not-json', { status: 200 })],
		['no access_token', () => new Response(JSON.stringify({ foo: 'bar' }), { status: 200 })],
	])('fails auth when the token response has %s', async (_label, makeResponse) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => makeResponse()),
		);
		const provider = new OAuth2Provider(ccConfig() as never);
		await expect(provider.getHeaders('application/json', true)).rejects.toThrow(
			/oauth2_auth_failed/,
		);
	});

	it('uses the configured identity base URL for the token endpoint', async () => {
		const fetchMock = vi.fn(async () => jsonOk({ access_token: 'CC', expires_in: 3600 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2Provider({
			baseUrl: 'https://tenant.creatio.local',
			auth: {
				kind: AuthProviderType.OAuth2,
				clientId: 'c',
				clientSecret: 's',
				idBaseUrl: 'https://id.creatio.local',
			},
		} as never);
		await provider.getHeaders('application/json', true);
		expect(String(fetchMock.mock.calls[0]![0])).toBe('https://id.creatio.local/0/connect/token');
	});

	it('refresh() forces a new token fetch', async () => {
		const fetchMock = vi.fn(async () => jsonOk({ access_token: 'CC', expires_in: 3600 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2Provider(ccConfig() as never);
		await provider.getHeaders('application/json', true);
		await provider.refresh();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
