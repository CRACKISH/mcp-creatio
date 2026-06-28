import { describe, expect, it } from 'vitest';

import { ODataCrudProvider } from '../../src/creatio/services/odata/odata-crud-provider';

function makeProvider(body: unknown = { value: [] }) {
	const calls: { url?: string } = {};
	const fakeClient = {
		normalizedBaseUrl: 'https://tenant',
		async getJsonHeaders() {
			return {};
		},
		logSuccess() {},
		async request(_op: string, url: string, _build: unknown, onSuccess: any) {
			calls.url = url;
			const response = {
				status: 200,
				ok: true,
				async json() {
					return body;
				},
			};
			return onSuccess(response, 0);
		},
	};
	const provider = new ODataCrudProvider(fakeClient as never, {} as never);
	return { provider, calls };
}

describe('ODataCrudProvider entity-name validation (C3 partial)', () => {
	it('rejects path-injection / non-identifier entity names', async () => {
		const { provider } = makeProvider();
		await expect(provider.read({ entity: '../Hack' } as never)).rejects.toThrow(
			/invalid_entity_name/,
		);
		await expect(provider.read({ entity: 'Contact/$count' } as never)).rejects.toThrow(
			/invalid_entity_name/,
		);
		await expect(provider.read({ entity: '' } as never)).rejects.toThrow(/invalid_entity_name/);
	});

	it('accepts a valid identifier entity name', async () => {
		const { provider, calls } = makeProvider();
		await provider.read({ entity: 'Contact' } as never);
		expect(calls.url).toContain('/0/odata/Contact');
	});
});

describe('ODataCrudProvider OData query building', () => {
	it('URL-encodes filter/select/top/orderBy/expand', async () => {
		const { provider, calls } = makeProvider();
		await provider.read({
			entity: 'Contact',
			columns: ['Id', 'Name'],
			top: 5,
			order: [{ field: 'Name', dir: 'desc' }],
			odata: { rawFilter: "Name eq 'A&B'", expand: ['Account'] },
		} as never);
		const url = calls.url ?? '';
		expect(url).toContain('$filter=' + encodeURIComponent("Name eq 'A&B'"));
		expect(url).toContain('$select=' + encodeURIComponent('Id,Name'));
		expect(url).toContain('$top=5');
		expect(url).toContain('$orderby=' + encodeURIComponent('Name desc'));
		expect(url).toContain('$expand=' + encodeURIComponent('Account'));
	});

	it('adds $skip only when > 0', async () => {
		const a = makeProvider();
		await a.provider.read({ entity: 'Contact', skip: 50 } as never);
		expect(a.calls.url).toContain('$skip=50');
		const b = makeProvider();
		await b.provider.read({ entity: 'Contact', skip: 0 } as never);
		expect(b.calls.url).not.toContain('$skip');
	});

	it('emits $top=0 for a count-only request', async () => {
		const { provider, calls } = makeProvider({ '@odata.count': 7, value: [] });
		await provider.read({ entity: 'Contact', count: true, top: 0 } as never);
		expect(calls.url).toContain('$top=0');
		expect(calls.url).toContain('$count=true');
	});
});

describe('ODataCrudProvider read result normalization', () => {
	it('returns { items, totalCount } from @odata.count when count is requested', async () => {
		const { provider } = makeProvider({ '@odata.count': 42, value: [{ Id: '1' }] });
		const res = await provider.read({ entity: 'Contact', count: true } as never);
		expect(res).toEqual({ items: [{ Id: '1' }], totalCount: 42 });
	});

	it('returns a bare { items } result when count is not requested', async () => {
		const { provider } = makeProvider({ value: [{ Id: '1' }] });
		const res = await provider.read({ entity: 'Contact' } as never);
		expect(res).toEqual({ items: [{ Id: '1' }] });
	});
});
