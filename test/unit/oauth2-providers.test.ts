import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { OAuth2CodeProvider } from '../../src/creatio/auth/providers/oauth2-code-provider';
import { OAuth2Provider } from '../../src/creatio/auth/providers/oauth2-provider';
import { SessionContext } from '../../src/sessions/session-context';
import { runWithContext } from '../../src/utils';
import { resetSessionContext } from '../support/test-server';

function codeConfig() {
	return {
		baseUrl: 'https://tenant.creatio.local',
		auth: {
			kind: AuthProviderType.OAuth2Code,
			clientId: 'client-1',
			clientSecret: 'secret',
			redirectUri: 'http://localhost/cb',
			scope: 'offline_access',
		},
	};
}

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

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('OAuth2CodeProvider auth-code operations', () => {
	it('builds the identity authorize URL with client_id, redirect and state', async () => {
		const url = await new OAuth2CodeProvider(codeConfig() as never).getAuthorizeUrl('STATE-1');
		expect(url).toContain('/0/connect/authorize');
		expect(url).toContain('client_id=client-1');
		expect(url).toContain('state=STATE-1');
		expect(url).toContain('redirect_uri=');
	});

	it('finishAuthorization exchanges the code and stores per-user tokens', async () => {
		resetSessionContext();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonOk({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })),
		);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await runWithContext({ userKey: 'u1' }, () => provider.finishAuthorization('CODE'));
		const saved = await SessionContext.instance.getTokensForUser('u1');
		expect(saved?.accessToken).toBe('AT');
		expect(saved?.refreshToken).toBe('RT');
		provider.cancelAllRefresh(); // clear the scheduled background timer
	});

	it('finishAuthorization fails without a user context', async () => {
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await expect(provider.finishAuthorization('CODE')).rejects.toThrow(/missing_user/);
	});

	it('finishAuthorization surfaces token-endpoint errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('bad', { status: 400 })),
		);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await expect(
			runWithContext({ userKey: 'u1' }, () => provider.finishAuthorization('CODE')),
		).rejects.toThrow(/oauth2_code_token_error/);
	});

	it('getHeaders throws a consent error (with start URL) when no tokens are stored', async () => {
		resetSessionContext();
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await runWithContext({ userKey: 'u1' }, async () => {
			await expect(provider.getHeaders('application/json', true)).rejects.toThrow(
				/oauth2_code_need_consent.*oauth\/start\?userKey=u1/,
			);
		});
	});

	it('revoke posts to the revocation endpoint and clears tokens', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: Date.now() + 1000,
			refreshToken: 'RT',
		});
		const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await runWithContext({ userKey: 'u1' }, () => provider.revoke());
		expect(String(fetchMock.mock.calls[0]![0])).toContain('/connect/revocation');
		expect(await SessionContext.instance.getTokensForUser('u1')).toBeNull();
	});

	it('revoke without a refresh token clears tokens without a network call', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'a',
			accessTokenExpiryMs: 1,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await runWithContext({ userKey: 'u1' }, () => provider.revoke());
		expect(fetchMock).not.toHaveBeenCalled();
		expect(await SessionContext.instance.getTokensForUser('u1')).toBeNull();
	});
});

describe('OAuth2CodeProvider ensureAccessToken / refresh', () => {
	it('returns a still-valid saved token without a network call', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'valid',
			accessTokenExpiryMs: Date.now() + 3_600_000,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		const headers = await runWithContext({ userKey: 'u1' }, () =>
			provider.getHeaders('application/json', true),
		);
		expect(headers.Authorization).toBe('Bearer valid');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes an expired token using the refresh token', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000,
			refreshToken: 'RT',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonOk({ access_token: 'fresh', refresh_token: 'RT2', expires_in: 3600 })),
		);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		const headers = await runWithContext({ userKey: 'u1' }, () =>
			provider.getHeaders('application/json', true),
		);
		expect(headers.Authorization).toBe('Bearer fresh');
		expect((await SessionContext.instance.getTokensForUser('u1'))?.refreshToken).toBe('RT2');
	});

	it('drops tokens and asks for consent when expired with no refresh token', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000,
		});
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await runWithContext({ userKey: 'u1' }, async () => {
			await expect(provider.getHeaders('application/json', true)).rejects.toThrow(
				/oauth2_code_need_consent/,
			);
		});
		expect(await SessionContext.instance.getTokensForUser('u1')).toBeNull();
	});

	it('refreshUserTokens (background) refreshes and persists', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000,
			refreshToken: 'RT',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonOk({ access_token: 'bg', refresh_token: 'RT3', expires_in: 3600 })),
		);
		const provider = new OAuth2CodeProvider(codeConfig() as never);
		await provider.refreshUserTokens('u1');
		expect((await SessionContext.instance.getTokensForUser('u1'))?.accessToken).toBe('bg');
	});
});

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
		expect(String(fetchMock.mock.calls[0]![0])).toBe(
			'https://id.creatio.local/0/connect/token',
		);
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
