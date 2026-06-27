import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCreatioClientConfig } from '../../src/config-builder';

// Auth resolution is covered in config-bearer-mode.test.ts; here we cover base URL + CRUD backend.
// Use delegated mode (needs no credentials) so these cases are isolated from auth concerns.
function baseEnv() {
	vi.stubEnv('CREATIO_BASE_URL', 'https://t.creatio.local');
	vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'delegated');
}

describe('getCreatioClientConfig — base URL', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('throws when CREATIO_BASE_URL is missing', () => {
		vi.stubEnv('CREATIO_BASE_URL', '');
		vi.stubEnv('CREATIO_MCP_AUTH_MODE', 'delegated');
		expect(() => getCreatioClientConfig()).toThrow(/CREATIO_BASE_URL/);
	});
});

describe('getCreatioClientConfig — CRUD backend (CREATIO_MCP_CRUD_BACKEND)', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('defaults to dataservice', () => {
		baseEnv();
		vi.stubEnv('CREATIO_MCP_CRUD_BACKEND', '');
		expect(getCreatioClientConfig().crudBackend).toBe('dataservice');
	});

	it('selects odata when set to odata', () => {
		baseEnv();
		vi.stubEnv('CREATIO_MCP_CRUD_BACKEND', 'odata');
		expect(getCreatioClientConfig().crudBackend).toBe('odata');
	});

	it('rejects an unknown backend', () => {
		baseEnv();
		vi.stubEnv('CREATIO_MCP_CRUD_BACKEND', 'graphql');
		expect(() => getCreatioClientConfig()).toThrow(/unsupported_crud_backend/);
	});

	it('still honors the deprecated CREATIO_CRUD_BACKEND alias', () => {
		baseEnv();
		vi.stubEnv('CREATIO_CRUD_BACKEND', 'odata');
		expect(getCreatioClientConfig().crudBackend).toBe('odata');
	});
});
