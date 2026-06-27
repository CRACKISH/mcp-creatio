import { afterEach, describe, expect, it, vi } from 'vitest';

import { ODataCrudProvider } from '../../src/creatio/services/odata/odata-crud-provider';
import { bodyOf, jsonResponse, makeHttpClientHarness, textResponse } from '../support/http-client';

afterEach(() => vi.unstubAllGlobals());

describe('ODataCrudProvider write operations', () => {
	it('create POSTs JSON to the entity set', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ Id: 'new' }));
		const provider = new ODataCrudProvider(client, {} as never);
		await provider.create({ entity: 'Contact', data: { Name: 'X' } });
		expect(calls[0].url).toBe('https://tenant.creatio.local/0/odata/Contact');
		expect(calls[0].init.method).toBe('POST');
		expect(bodyOf(calls[0])).toEqual({ Name: 'X' });
	});

	it('update PATCHes by a bare GUID key', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse(''));
		const provider = new ODataCrudProvider(client, {} as never);
		await provider.update({
			entity: 'Contact',
			id: '11111111-1111-1111-1111-111111111111',
			data: { Name: 'Y' },
		});
		expect(calls[0].init.method).toBe('PATCH');
		expect(calls[0].url).toContain('/Contact(11111111-1111-1111-1111-111111111111)');
	});

	it('quotes and escapes a non-GUID string key', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse(''));
		const provider = new ODataCrudProvider(client, {} as never);
		await provider.update({ entity: 'Contact', id: "a'b", data: {} });
		expect(calls[0].url).toContain("/Contact('a''b')");
	});

	it('delete issues DELETE by a numeric key', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse(''));
		const provider = new ODataCrudProvider(client, {} as never);
		await provider.delete({ entity: 'Contact', id: '5' });
		expect(calls[0].init.method).toBe('DELETE');
		expect(calls[0].url).toContain('/Contact(5)');
	});

	it('surfaces a create error from a non-2xx response', async () => {
		const { client } = makeHttpClientHarness(() => jsonResponse({ error: 'x' }, 400));
		const provider = new ODataCrudProvider(client, {} as never);
		await expect(provider.create({ entity: 'Contact', data: {} })).rejects.toThrow(
			/creatio_create_failed/,
		);
	});
});
