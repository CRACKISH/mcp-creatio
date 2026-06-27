import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { OAuth2CodeProvider } from '../../src/creatio/auth/providers/oauth2-code-provider';
import { SessionContext } from '../../src/sessions/session-context';
import { JSON_ACCEPT } from '../../src/types';
import { runWithContext } from '../../src/utils';

function makeConfig() {
	return {
		baseUrl: 'https://tenant.creatio.local',
		auth: {
			kind: AuthProviderType.OAuth2Code,
			clientId: 'client',
			clientSecret: 'secret',
			redirectUri: 'http://localhost:1/cb',
		},
	};
}

describe('OAuth2CodeProvider — refresh dedup (H2) & per-user cache (C1)', () => {
	beforeEach(() => {
		(SessionContext.instance as unknown as { _userTokens: Map<string, unknown> })._userTokens.clear();
	});

	it('collapses concurrent refreshes into a single network call', async () => {
		const provider = new OAuth2CodeProvider(makeConfig() as never);
		const refreshSpy = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return {
				accessToken: 'new-token',
				accessTokenExpiryMs: Date.now() + 3_600_000,
				refreshToken: 'r2',
			};
		});
		(provider as unknown as { _refreshTokens: unknown })._refreshTokens = refreshSpy;

		await SessionContext.instance.setTokensForUser('u1', {
			accessToken: 'old',
			accessTokenExpiryMs: Date.now() - 1000, // expired -> forces refresh
			refreshToken: 'r1',
		});

		await runWithContext({ userKey: 'u1' }, async () => {
			const headers = await Promise.all(
				Array.from({ length: 20 }, () => provider.getHeaders(JSON_ACCEPT, true)),
			);
			for (const h of headers) {
				expect(h.Authorization).toBe('Bearer new-token');
			}
		});

		expect(refreshSpy).toHaveBeenCalledTimes(1);
		const saved = await SessionContext.instance.getTokensForUser('u1');
		expect(saved?.accessToken).toBe('new-token');
	});

	it('serves each user from their own tokens (no cross-user bleed)', async () => {
		const provider = new OAuth2CodeProvider(makeConfig() as never);
		(provider as unknown as { _refreshTokens: unknown })._refreshTokens = vi.fn(async () => {
			throw new Error('should not refresh — tokens are valid');
		});
		const future = Date.now() + 3_600_000;
		await SessionContext.instance.setTokensForUser('alice', {
			accessToken: 'alice-tok',
			accessTokenExpiryMs: future,
		});
		await SessionContext.instance.setTokensForUser('bob', {
			accessToken: 'bob-tok',
			accessTokenExpiryMs: future,
		});

		const a = await runWithContext({ userKey: 'alice' }, () =>
			provider.getHeaders(JSON_ACCEPT, true),
		);
		const b = await runWithContext({ userKey: 'bob' }, () =>
			provider.getHeaders(JSON_ACCEPT, true),
		);

		expect(a.Authorization).toBe('Bearer alice-tok');
		expect(b.Authorization).toBe('Bearer bob-tok');
	});
});
