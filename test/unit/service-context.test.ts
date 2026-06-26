import { describe, expect, it } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { CreatioServiceContext } from '../../src/creatio/services/creatio-service-context';

describe('CreatioServiceContext', () => {
	it('wires every provider and exposes the auth provider', () => {
		const ctx = new CreatioServiceContext({
			baseUrl: 'https://tenant.creatio.local',
			auth: { kind: AuthProviderType.OAuth2, clientId: 'c', clientSecret: 's' },
		} as never);

		expect(ctx.kind).toBe('creatio-services');
		expect(ctx.crud).toBeTruthy();
		expect(ctx.configuration).toBeTruthy();
		expect(ctx.adminOperation).toBeTruthy();
		expect(ctx.feature).toBeTruthy();
		expect(ctx.process).toBeTruthy();
		expect(ctx.sysSettings).toBeTruthy();
		expect(ctx.user).toBeTruthy();
		expect(ctx.authProvider.type).toBe(AuthProviderType.OAuth2);
	});
});
