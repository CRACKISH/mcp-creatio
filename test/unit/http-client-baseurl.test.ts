import { describe, expect, it } from 'vitest';

import { AuthProviderType, CreatioAuthManager } from '../../src/creatio';
import { CreatioHttpClient } from '../../src/creatio/services/http-client';
import { runWithContext } from '../../src/utils';

function client() {
	const config = {
		baseUrl: 'https://base.creatio.local/',
		auth: { kind: AuthProviderType.Legacy, login: 'l', password: 'p' },
	} as never;
	return new CreatioHttpClient(config, new CreatioAuthManager(config));
}

describe('CreatioHttpClient.normalizedBaseUrl — per-request override', () => {
	it('uses the configured base URL when no override is present', () => {
		expect(client().normalizedBaseUrl).toBe('https://base.creatio.local');
	});

	it('honors a gateway-supplied per-request base URL override', async () => {
		const c = client();
		await runWithContext({ baseUrlOverride: 'https://tenant-b.creatio.local/' }, async () => {
			expect(c.normalizedBaseUrl).toBe('https://tenant-b.creatio.local');
		});
		// reverts outside the request context
		expect(c.normalizedBaseUrl).toBe('https://base.creatio.local');
	});
});
