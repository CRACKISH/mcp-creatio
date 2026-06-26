import { describe, expect, it } from 'vitest';

import { AuthProviderType, CreatioAuthManager } from '../../src/creatio';
import { BaseProvider } from '../../src/creatio/auth/providers/base-provider';
import { NAME, VERSION } from '../../src/version';

describe('CreatioAuthManager', () => {
	it('builds a legacy provider', () => {
		const m = new CreatioAuthManager({
			baseUrl: 'https://x',
			auth: { kind: AuthProviderType.Legacy, login: 'l', password: 'p' },
		} as never);
		expect(m.getProvider().type).toBe(AuthProviderType.Legacy);
	});

	it('builds an OAuth2 client-credentials provider', () => {
		const m = new CreatioAuthManager({
			baseUrl: 'https://x',
			auth: { kind: AuthProviderType.OAuth2, clientId: 'c', clientSecret: 's' },
		} as never);
		expect(m.getProvider().type).toBe(AuthProviderType.OAuth2);
	});

	it('builds an OAuth2 authorization-code provider', () => {
		const m = new CreatioAuthManager({
			baseUrl: 'https://x',
			auth: {
				kind: AuthProviderType.OAuth2Code,
				clientId: 'c',
				clientSecret: 's',
				redirectUri: 'http://localhost/cb',
			},
		} as never);
		expect(m.getProvider().type).toBe(AuthProviderType.OAuth2Code);
	});

	it('throws for an unsupported auth kind', () => {
		expect(
			() => new CreatioAuthManager({ baseUrl: 'https://x', auth: { kind: 'nope' } } as never),
		).toThrow(/unsupported_auth_config/);
	});
});

describe('BaseProvider default stubs (ISP gap)', () => {
	class BareProvider extends BaseProvider {}

	const provider = new BareProvider({
		baseUrl: 'https://x',
		auth: { kind: AuthProviderType.Legacy, login: 'l', password: 'p' },
	} as never);

	it('exposes the configured auth kind as type', () => {
		expect(provider.type).toBe(AuthProviderType.Legacy);
	});

	it('throws "not implemented" for the unimplemented operations', () => {
		// These stubs throw synchronously despite the Promise return type.
		expect(() => provider.getHeaders('application/json')).toThrow(/not implemented/i);
		expect(() => provider.refresh()).toThrow(/not implemented/i);
		expect(() => provider.revoke()).toThrow(/not implemented/i);
		expect(() => provider.getAuthorizeUrl('s')).toThrow(/not implemented/i);
		expect(() => provider.finishAuthorization('c')).toThrow(/not implemented/i);
	});

	it('cancelAllRefresh is a safe no-op', () => {
		expect(() => provider.cancelAllRefresh()).not.toThrow();
	});
});

describe('version', () => {
	it('exposes a name and version string', () => {
		expect(typeof NAME).toBe('string');
		expect(NAME.length).toBeGreaterThan(0);
		expect(typeof VERSION).toBe('string');
		expect(VERSION.length).toBeGreaterThan(0);
	});
});
