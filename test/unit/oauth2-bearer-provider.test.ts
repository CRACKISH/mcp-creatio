import { describe, expect, it } from 'vitest';

import { AuthProviderType, BearerAuthMode } from '../../src/creatio';
import { OAuth2BearerProvider } from '../../src/creatio/auth/providers/oauth2-bearer-provider';
import { runWithContext } from '../../src/utils';

function bearerConfig(mode: BearerAuthMode = BearerAuthMode.Delegated) {
	return {
		baseUrl: 'https://tenant.creatio.local',
		auth: { kind: AuthProviderType.OAuth2Bearer, mode },
	};
}

describe('OAuth2BearerProvider', () => {
	it('passes the per-request Bearer token straight through to Creatio headers', async () => {
		const provider = new OAuth2BearerProvider(bearerConfig() as never);
		const headers = await runWithContext({ bearerToken: 'CREATIO-AT' }, () =>
			provider.getHeaders('application/json', true),
		);
		expect(headers.Authorization).toBe('Bearer CREATIO-AT');
		expect(headers['Content-Type']).toBe('application/json');
	});

	it('throws bearer_token_required when no token is present in the request context', async () => {
		const provider = new OAuth2BearerProvider(bearerConfig() as never);
		await expect(provider.getHeaders('application/json', true)).rejects.toThrow(
			/bearer_token_required/,
		);
	});

	it('treats refresh as a no-op (token lifecycle is owned by the client/gateway)', async () => {
		const provider = new OAuth2BearerProvider(bearerConfig() as never);
		await expect(provider.refresh()).resolves.toBeUndefined();
	});

	it('exposes its auth kind', () => {
		const provider = new OAuth2BearerProvider(bearerConfig(BearerAuthMode.Gateway) as never);
		expect(provider.type).toBe(AuthProviderType.OAuth2Bearer);
	});
});
