import { describe, expect, it, vi } from 'vitest';

import {
	ConfigurationCallResult,
	ConfigurationCaller,
	DataForgeClient,
	SysSettingReader,
} from '../../src/server/mcp/dataforge/dataforge-client';

function makeClient(overrides?: {
	call?: ConfigurationCaller['call'];
	queryValues?: SysSettingReader['queryValues'];
}) {
	const call = vi.fn(
		overrides?.call ??
			(async () => ({ status: 200, body: { ok: true } }) as ConfigurationCallResult),
	);
	const queryValues = vi.fn(
		overrides?.queryValues ?? (async () => ({ values: {} as Record<string, unknown> })),
	);
	const client = new DataForgeClient({ call }, { queryValues });
	return { client, call, queryValues };
}

describe('DataForgeClient.isEnabled', () => {
	// Real QuerySysSettings shape: each setting is an object { code, value, ... }.
	it('is true when the nested setting value is a non-empty URL', async () => {
		const { client, queryValues } = makeClient({
			queryValues: async () => ({
				values: { DataForgeServiceUrl: { code: 'DataForgeServiceUrl', value: 'https://df/' } },
			}),
		});
		expect(await client.isEnabled()).toBe(true);
		expect(queryValues).toHaveBeenCalledWith(['DataForgeServiceUrl']);
	});

	it('also tolerates a bare string value', async () => {
		const { client } = makeClient({
			queryValues: async () => ({ values: { DataForgeServiceUrl: 'https://df/' } }),
		});
		expect(await client.isEnabled()).toBe(true);
	});

	it.each([
		['empty', ''],
		['whitespace', '   '],
		['missing', undefined],
		['non-string', 123],
	])('is false when the nested value is %s', async (_label, value) => {
		const { client } = makeClient({
			queryValues: async () => ({ values: { DataForgeServiceUrl: { value } } }),
		});
		expect(await client.isEnabled()).toBe(false);
	});

	it('is false when the setting is absent entirely', async () => {
		const { client } = makeClient({ queryValues: async () => ({ values: {} }) });
		expect(await client.isEnabled()).toBe(false);
	});

	it('is false (degrades gracefully) when the probe throws', async () => {
		const { client } = makeClient({
			queryValues: async () => {
				throw new Error('boom');
			},
		});
		expect(await client.isEnabled()).toBe(false);
	});
});

describe('DataForgeClient read requests', () => {
	it('wraps similar-table queries under request and omits undefined fields', async () => {
		const { client, call } = makeClient();
		await client.getSimilarTableNames({ query: 'tickets' });
		expect(call).toHaveBeenCalledWith({
			service: 'DataForgeSchemaReadService',
			method: 'GetSimilarTableNames',
			httpMethod: 'POST',
			body: { request: { query: 'tickets' } },
		});
	});

	it('passes relationship parameters through, omitting only undefined ones', async () => {
		const { client, call } = makeClient();
		await client.getTableRelationships({
			sourceTable: 'Contact',
			targetTable: 'Account',
			bidirectional: false,
		});
		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GetTableRelationships',
				body: {
					request: {
						sourceTable: 'Contact',
						targetTable: 'Account',
						bidirectional: false,
					},
				},
			}),
		);
	});

	it('builds lookup-value requests with the optional schema name', async () => {
		const { client, call } = makeClient();
		await client.getLookupValues({ query: 'vip', schemaName: 'CaseStatus', limit: 3 });
		expect(call).toHaveBeenCalledWith(
			expect.objectContaining({
				method: 'GetLookupValues',
				body: { request: { query: 'vip', schemaName: 'CaseStatus', limit: 3 } },
			}),
		);
	});

	it('calls the maintenance service for status', async () => {
		const { client, call } = makeClient();
		await client.getServiceStatus();
		expect(call).toHaveBeenCalledWith({
			service: 'DataForgeMaintenanceService',
			method: 'GetServiceStatus',
			httpMethod: 'POST',
			body: {},
		});
	});
});

describe('DataForgeClient.getColumnsOrNull', () => {
	it('returns the body on success', async () => {
		const { client } = makeClient({
			call: async () => ({ status: 200, body: { columns: ['Id', 'Name'] } }),
		});
		expect(await client.getColumnsOrNull('Contact')).toEqual({ columns: ['Id', 'Name'] });
	});

	it('returns null when DataForge reports Success:false', async () => {
		const { client } = makeClient({
			call: async () => ({
				status: 200,
				body: { Success: false, ErrorInfo: { ErrorCode: 'AccessDenied' } },
			}),
		});
		expect(await client.getColumnsOrNull('Contact')).toBeNull();
	});

	it('returns null when the call throws', async () => {
		const { client } = makeClient({
			call: async () => {
				throw new Error('network');
			},
		});
		expect(await client.getColumnsOrNull('Contact')).toBeNull();
	});

	// Real WCF shape observed via smoke: payload nested under `<Method>Result`,
	// with camelCase `success`/`errorInfo`.
	it('unwraps the WCF *Result envelope and detects camelCase failure', async () => {
		const { client } = makeClient({
			call: async () => ({
				status: 200,
				body: {
					GetTableColumnsDetailsResult: {
						success: false,
						errorInfo: { message: 'Value cannot be null. Parameter name: baseUri' },
						Data: null,
					},
				},
			}),
		});
		expect(await client.getColumnsOrNull('Contact')).toBeNull();
	});

	it('unwraps the WCF *Result envelope and returns the inner payload on success', async () => {
		const inner = { success: true, Data: [{ name: 'Id' }, { name: 'Name' }] };
		const { client } = makeClient({
			call: async () => ({ status: 200, body: { GetTableColumnsDetailsResult: inner } }),
		});
		expect(await client.getColumnsOrNull('Contact')).toEqual(inner);
	});
});
