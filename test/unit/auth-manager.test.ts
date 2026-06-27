import { describe, expect, it } from 'vitest';

import {
	AuthProviderType,
	CreatioAuthManager,
	supportsInteractiveAuth,
	supportsRevoke,
} from '../../src/creatio';
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

describe('BaseProvider core capability (ISP)', () => {
	// A provider only has to implement the core capability (getHeaders/refresh); optional
	// capabilities (revoke, interactive authorize) are added by interface, not stubbed.
	class CoreOnlyProvider extends BaseProvider {
		public async getHeaders() {
			return {};
		}
		public async refresh() {
			/* noop */
		}
	}

	const provider = new CoreOnlyProvider({
		baseUrl: 'https://x',
		auth: { kind: AuthProviderType.Legacy, login: 'l', password: 'p' },
	} as never);

	it('exposes the configured auth kind as type', () => {
		expect(provider.type).toBe(AuthProviderType.Legacy);
	});

	it('cancelAllRefresh is a safe no-op', () => {
		expect(() => provider.cancelAllRefresh()).not.toThrow();
	});

	it('does not advertise optional capabilities it has not implemented', () => {
		expect(supportsRevoke(provider)).toBe(false);
		expect(supportsInteractiveAuth(provider)).toBe(false);
	});
});

describe('auth provider capabilities (ISP guards)', () => {
	function build(auth: Record<string, unknown>) {
		return new CreatioAuthManager({ baseUrl: 'https://x', auth } as never).getProvider();
	}

	it('legacy supports neither revoke nor interactive auth', () => {
		const p = build({ kind: AuthProviderType.Legacy, login: 'l', password: 'p' });
		expect(supportsRevoke(p)).toBe(false);
		expect(supportsInteractiveAuth(p)).toBe(false);
	});

	it('authorization-code provider supports revoke + interactive auth', () => {
		const p = build({
			kind: AuthProviderType.OAuth2Code,
			clientId: 'c',
			clientSecret: 's',
			redirectUri: 'http://localhost/cb',
		});
		expect(supportsRevoke(p)).toBe(true);
		expect(supportsInteractiveAuth(p)).toBe(true);
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
