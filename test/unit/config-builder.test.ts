import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCreatioClientConfig } from '../../src/config-builder';
import { AuthProviderType } from '../../src/creatio';

const AUTH_VARS = [
	'CREATIO_CODE_CLIENT_ID',
	'CREATIO_CODE_CLIENT_SECRET',
	'CREATIO_CODE_REDIRECT_URI',
	'CREATIO_CODE_SCOPE',
	'CREATIO_CLIENT_ID',
	'CREATIO_CLIENT_SECRET',
	'CREATIO_ID_BASE_URL',
	'CREATIO_LOGIN',
	'CREATIO_PASSWORD',
];

function clearAuthVars() {
	for (const v of AUTH_VARS) {
		vi.stubEnv(v, '');
	}
}

describe('getCreatioClientConfig', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('throws when CREATIO_BASE_URL is missing', () => {
		vi.stubEnv('CREATIO_BASE_URL', '');
		expect(() => getCreatioClientConfig()).toThrow(/CREATIO_BASE_URL/);
	});

	it('throws when no auth configuration is provided', () => {
		vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
		clearAuthVars();
		expect(() => getCreatioClientConfig()).toThrow(/must set either/);
	});

	it('prefers the OAuth2 authorization-code config when fully set', () => {
		vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
		clearAuthVars();
		vi.stubEnv('CREATIO_CODE_CLIENT_ID', 'cid');
		vi.stubEnv('CREATIO_CODE_CLIENT_SECRET', 'csec');
		vi.stubEnv('CREATIO_CODE_REDIRECT_URI', 'http://localhost/cb');
		vi.stubEnv('CREATIO_CODE_SCOPE', 'offline_access');
		// also set client-credentials + legacy to prove precedence
		vi.stubEnv('CREATIO_CLIENT_ID', 'x');
		vi.stubEnv('CREATIO_CLIENT_SECRET', 'y');
		vi.stubEnv('CREATIO_LOGIN', 'l');
		vi.stubEnv('CREATIO_PASSWORD', 'p');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.OAuth2Code);
	});

	it('uses client-credentials over legacy when the code config is absent', () => {
		vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
		clearAuthVars();
		vi.stubEnv('CREATIO_CLIENT_ID', 'x');
		vi.stubEnv('CREATIO_CLIENT_SECRET', 'y');
		vi.stubEnv('CREATIO_LOGIN', 'l');
		vi.stubEnv('CREATIO_PASSWORD', 'p');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.OAuth2);
	});

	it('falls back to legacy login/password', () => {
		vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
		clearAuthVars();
		vi.stubEnv('CREATIO_LOGIN', 'l');
		vi.stubEnv('CREATIO_PASSWORD', 'p');
		expect(getCreatioClientConfig().auth.kind).toBe(AuthProviderType.Legacy);
	});
});
