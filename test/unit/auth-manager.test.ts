import { describe, expect, it } from 'vitest';

import { AuthProviderType, BearerAuthMode, CreatioAuthManager } from '../../src/creatio';
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

	it('builds a stateless Bearer provider (delegated)', () => {
		const m = new CreatioAuthManager({
			baseUrl: 'https://x',
			auth: { kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Delegated },
		} as never);
		expect(m.getProvider().type).toBe(AuthProviderType.OAuth2Bearer);
	});

	it('builds a broker provider', () => {
		const m = new CreatioAuthManager({
			baseUrl: 'https://x',
			auth: { kind: AuthProviderType.Broker, clientId: 'app', jwtSecret: 'jwt' },
		} as never);
		expect(m.getProvider().type).toBe(AuthProviderType.Broker);
	});

	it('throws for an unsupported auth kind', () => {
		expect(
			() => new CreatioAuthManager({ baseUrl: 'https://x', auth: { kind: 'nope' } } as never),
		).toThrow(/unsupported_auth_config/);
	});
});

describe('BaseProvider core capability (ISP)', () => {
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
});

describe('version', () => {
	it('exposes a name and version string', () => {
		expect(typeof NAME).toBe('string');
		expect(NAME.length).toBeGreaterThan(0);
		expect(typeof VERSION).toBe('string');
		expect(VERSION.length).toBeGreaterThan(0);
	});
});
