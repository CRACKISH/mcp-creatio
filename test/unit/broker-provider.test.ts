import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { BrokerProvider } from '../../src/creatio/auth/providers/broker-provider';
import { SessionContext } from '../../src/sessions/session-context';
import { runWithContext } from '../../src/utils';
import { resetSessionContext } from '../support/test-server';

function config() {
	return {
		baseUrl: 'https://t.creatio.local',
		auth: { kind: AuthProviderType.Broker, clientId: 'app-1', jwtSecret: 'jwt' },
	} as never;
}
function jsonOk(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('BrokerProvider — serves stored per-user Creatio tokens', () => {
	it('returns the stored valid token without a network call', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'AT',
			accessTokenExpiryMs: Date.now() + 3_600_000,
		});
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const headers = await runWithContext({ userKey: 'u1' }, () =>
			new BrokerProvider(config()).getHeaders('application/json', true),
		);
		expect(headers.Authorization).toBe('Bearer AT');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes an expired token via the refresh token and persists it', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000,
			refreshToken: 'RT',
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({ access_token: 'fresh', refresh_token: 'RT2', expires_in: 3600 }),
			),
		);
		const headers = await runWithContext({ userKey: 'u1' }, () =>
			new BrokerProvider(config()).getHeaders('application/json', true),
		);
		expect(headers.Authorization).toBe('Bearer fresh');
		expect((await SessionContext.instance.getTokensForUser('u1'))?.refreshToken).toBe('RT2');
	});

	it('throws when the user has no stored tokens', async () => {
		resetSessionContext();
		await expect(
			runWithContext({ userKey: 'nobody' }, () =>
				new BrokerProvider(config()).getHeaders('application/json', true),
			),
		).rejects.toThrow(/broker_not_authorized/);
	});

	it('drops tokens and throws when expired with no refresh token', async () => {
		resetSessionContext();
		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000,
		});
		await expect(
			runWithContext({ userKey: 'u1' }, () =>
				new BrokerProvider(config()).getHeaders('application/json', true),
			),
		).rejects.toThrow(/broker_token_expired/);
		expect(await SessionContext.instance.getTokensForUser('u1')).toBeNull();
	});

	it('throws without a user context', async () => {
		await expect(
			new BrokerProvider(config()).getHeaders('application/json', true),
		).rejects.toThrow(/broker_no_user/);
	});
});
