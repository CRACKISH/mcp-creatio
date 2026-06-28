import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCreatioClientConfig } from '../../src/config-builder';
import { AuthProviderType, BearerAuthMode } from '../../src/creatio';

const VARS = [
	'CREATIO_MCP_AUTH_MODE',
	'CREATIO_ID_BASE_URL',
	'CREATIO_CLIENT_ID',
	'CREATIO_CLIENT_SECRET',
	'CREATIO_MCP_JWT_SECRET',
	'CREATIO_LOGIN',
	'CREATIO_PASSWORD',
	'NODE_ENV',
];

// A secret that clears the 32-char HS256 entropy floor.
const STRONG_SECRET = 'a-stable-broker-secret-of-sufficient-length-0123456789';

function clean() {
	for (const v of VARS) {
		vi.stubEnv(v, '');
	}
	vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
}

describe('CREATIO_MCP_AUTH_MODE — unified auth resolver', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('explicit delegated → stateless Bearer (delegated)', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'delegated');
		const auth = getCreatioClientConfig().auth;
		expect(auth.kind).toBe(AuthProviderType.OAuth2Bearer);
		expect((auth as { mode: BearerAuthMode }).mode).toBe(BearerAuthMode.Delegated);
	});

	it('explicit gateway → stateless Bearer (gateway), picks up idBaseUrl', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'gateway');
		vi.stubEnv('CREATIO_ID_BASE_URL', 'https://id.creatio.local');
		const auth = getCreatioClientConfig().auth;
		expect(auth).toMatchObject({
			kind: AuthProviderType.OAuth2Bearer,
			mode: BearerAuthMode.Gateway,
			idBaseUrl: 'https://id.creatio.local',
		});
	});

	it('explicit broker requires client id (throws when missing)', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'broker');
		expect(() => getCreatioClientConfig()).toThrow(/broker auth requires/);
	});

	it('explicit broker builds from CREATIO_CLIENT_ID + CREATIO_MCP_JWT_SECRET', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'broker');
		vi.stubEnv('CREATIO_CLIENT_ID', 'app-1');
		vi.stubEnv('CREATIO_MCP_JWT_SECRET', STRONG_SECRET);
		const auth = getCreatioClientConfig().auth;
		expect(auth).toMatchObject({
			kind: AuthProviderType.Broker,
			clientId: 'app-1',
			jwtSecret: STRONG_SECRET,
		});
	});

	it('broker rejects a JWT secret weaker than 32 chars (HS256 entropy floor)', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'broker');
		vi.stubEnv('CREATIO_CLIENT_ID', 'app-1');
		vi.stubEnv('CREATIO_MCP_JWT_SECRET', 'too-short');
		expect(() => getCreatioClientConfig()).toThrow(/too weak/);
	});

	it('broker fails closed in production when no JWT secret is set', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'broker');
		vi.stubEnv('CREATIO_CLIENT_ID', 'app-1');
		vi.stubEnv('NODE_ENV', 'production');
		expect(() => getCreatioClientConfig()).toThrow(/required in production/);
	});

	it('broker JWT secret is optional — an ephemeral one is generated when unset', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'broker');
		vi.stubEnv('CREATIO_CLIENT_ID', 'app-1');
		const auth = getCreatioClientConfig().auth as { kind: AuthProviderType; jwtSecret: string };
		expect(auth.kind).toBe(AuthProviderType.Broker);
		// A usable secret is always present; generated ones are long & random.
		expect(typeof auth.jwtSecret).toBe('string');
		expect(auth.jwtSecret.length).toBeGreaterThanOrEqual(32);
	});

	it('explicit client_credentials requires id + secret (throws when missing)', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'client_credentials');
		expect(() => getCreatioClientConfig()).toThrow(/client_credentials auth requires/);
	});

	it('explicit legacy requires login + password (throws when missing)', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'legacy');
		expect(() => getCreatioClientConfig()).toThrow(/legacy auth requires/);
	});

	it('rejects an unknown mode', () => {
		clean();
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'magic');
		expect(() => getCreatioClientConfig()).toThrow(/unsupported_auth_mode/);
	});
});

describe('CREATIO_MCP_AUTH_MODE — inference when unset', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('infers legacy from login/password', () => {
		clean();
		vi.stubEnv('CREATIO_LOGIN', 'l');
		vi.stubEnv('CREATIO_PASSWORD', 'p');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.Legacy);
	});

	it('infers client_credentials from id/secret (over nothing)', () => {
		clean();
		vi.stubEnv('CREATIO_CLIENT_ID', 'c');
		vi.stubEnv('CREATIO_CLIENT_SECRET', 's');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.OAuth2);
	});

	it('prefers legacy over client_credentials when both are present', () => {
		clean();
		vi.stubEnv('CREATIO_LOGIN', 'l');
		vi.stubEnv('CREATIO_PASSWORD', 'p');
		vi.stubEnv('CREATIO_CLIENT_ID', 'c');
		vi.stubEnv('CREATIO_CLIENT_SECRET', 's');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.Legacy);
	});

	it('defaults to delegated when nothing is configured (HTTP multi-user)', () => {
		clean();
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.OAuth2Bearer);
	});
});
