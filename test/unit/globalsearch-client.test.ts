import { describe, expect, it, vi } from 'vitest';

import {
	ConfigurationCallResult,
	ConfigurationCaller,
	SysSettingReader,
} from '../../src/server/mcp/creatio-rest';
import { GlobalSearchClient } from '../../src/server/mcp/globalsearch/globalsearch-client';

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
	const client = new GlobalSearchClient({ call }, { queryValues });
	return { client, call, queryValues };
}

describe('GlobalSearchClient.isEnabled', () => {
	it('is true when GlobalSearchUrl has a non-empty nested value', async () => {
		const { client, queryValues } = makeClient({
			queryValues: async () => ({
				values: {
					GlobalSearchUrl: { code: 'GlobalSearchUrl', value: 'http://es:9200/gs' },
				},
			}),
		});
		expect(await client.isEnabled()).toBe(true);
		expect(queryValues).toHaveBeenCalledWith(['GlobalSearchUrl']);
	});

	it.each([
		['empty', ''],
		['whitespace', '   '],
		['missing', undefined],
	])('is false when the value is %s', async (_label, value) => {
		const { client } = makeClient({
			queryValues: async () => ({ values: { GlobalSearchUrl: { value } } }),
		});
		expect(await client.isEnabled()).toBe(false);
	});

	it('is false when the probe throws', async () => {
		const { client } = makeClient({
			queryValues: async () => {
				throw new Error('boom');
			},
		});
		expect(await client.isEnabled()).toBe(false);
	});
});

describe('GlobalSearchClient.search', () => {
	it('posts a flat wrapped body to GlobalSearchService.Search', async () => {
		const { client, call } = makeClient();
		await client.search({ query: 'andrew baker' });
		// The three no-default params must always be present (else WCF 400); `type` is
		// omitted when not filtering, matching the proven UI call shape.
		expect(call).toHaveBeenCalledWith({
			service: 'GlobalSearchService',
			method: 'Search',
			httpMethod: 'POST',
			body: { queryString: 'andrew baker', sectionEntityName: '', recordCount: 15, from: 0 },
		});
	});

	it('adds the type filter only when entities are provided, and passes paging', async () => {
		const { client, call } = makeClient();
		await client.search({ query: 'acme', type: 'Contact,Account', recordCount: 20, from: 30 });
		expect(call.mock.calls[0]![0].body).toEqual({
			queryString: 'acme',
			sectionEntityName: '',
			recordCount: 20,
			from: 30,
			type: 'Contact,Account',
		});
	});

	it('parses the stringified SearchResult and projects a compact shape', async () => {
		const searchResult = JSON.stringify({
			took: 41,
			total: 2,
			nextFrom: 15,
			success: true,
			errorInfo: null,
			data: [
				{
					entityName: 'Account',
					id: 'acc-1',
					columnValues: { Name: 'Sbear Financial', Address: '6476 Van Nuys Blvd' },
					foundColumns: { Address: ['Van'] },
				},
				{
					entityName: 'Contact',
					id: 'c-1',
					columnValues: { Name: { value: 'x', displayValue: 'Athanasakos Van' } },
					foundColumns: { Name: ['Van'] },
				},
			],
		});
		const { client } = makeClient({
			call: async () => ({ status: 200, body: { SearchResult: searchResult } }),
		});
		const result = (await client.search({ query: 'van' })) as {
			total: number;
			nextFrom: number;
			results: Array<{ entityName: string; id: string; title?: string; matched: unknown }>;
		};
		expect(result.total).toBe(2);
		expect(result.nextFrom).toBe(15);
		expect(result.results).toEqual([
			{
				entityName: 'Account',
				id: 'acc-1',
				title: 'Sbear Financial',
				matched: { Address: ['Van'] },
			},
			{
				entityName: 'Contact',
				id: 'c-1',
				title: 'Athanasakos Van',
				matched: { Name: ['Van'] },
			},
		]);
	});
});
