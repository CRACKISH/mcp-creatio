import { afterEach, describe, expect, it, vi } from 'vitest';

import { DataServiceCrudProvider, DataServiceQueryBuilder, DataValueType } from '../../src/creatio';
import { bodyOf, jsonResponse, makeHttpClientHarness } from '../support/http-client';

afterEach(() => vi.unstubAllGlobals());

// Live-found: DataService sorts only by a column of the query, and ignores sorting entirely in
// all-columns mode — so `orderBy` on an unselected field, or with no `select`, was silently dropped.
describe('DataService ordering on fields that are not selected', () => {
	it('adds an order-only column carrying the sort', () => {
		const select = new DataServiceQueryBuilder().buildSelectQuery({
			entity: 'Contact',
			columns: ['Id'],
			order: [{ field: 'Name', dir: 'desc' }],
		});
		expect(Object.keys(select.columns.items)).toEqual(['Id', 'Name']);
		expect(select.columns.items.Name).toMatchObject({
			expression: { columnPath: 'Name' },
			orderDirection: 2,
			orderPosition: 1,
		});
	});

	it('expands an ordered all-columns read to the schema columns, and strips order-only columns', async () => {
		const { client, calls } = makeHttpClientHarness((url) => {
			if (url.endsWith('/RuntimeEntitySchemaRequest')) {
				return jsonResponse({
					success: true,
					schema: {
						name: 'Contact',
						columns: {
							Items: {
								Id: { name: 'Id', dataValueType: DataValueType.Guid },
								Name: { name: 'Name', dataValueType: DataValueType.Text },
							},
						},
					},
				});
			}
			return jsonResponse({ success: true, rows: [{ Id: '1', Name: 'B' }] });
		});
		const provider = new DataServiceCrudProvider(client);

		const all = await provider.read({
			entity: 'Contact',
			order: [{ field: 'Name', dir: 'asc' }],
		});
		const allSelect = bodyOf(calls.find((c) => c.url.endsWith('/SelectQuery'))!) as any;
		expect(allSelect.allColumns).toBe(false);
		expect(Object.keys(allSelect.columns.items)).toEqual(['Id', 'Name']);
		expect(allSelect.columns.items.Name.orderPosition).toBe(1);
		expect(all.items).toEqual([{ Id: '1', Name: 'B' }]);

		const projected = await provider.read({
			entity: 'Contact',
			columns: ['Id'],
			order: [{ field: 'Name', dir: 'asc' }],
		});
		expect(projected.items).toEqual([{ Id: '1' }]);
	});

	it('rewrites XxxId only for a known lookup Xxx (a real `FacebookId` column stays as-is)', () => {
		const builder = new DataServiceQueryBuilder();
		const query = { entity: 'Contact', columns: ['FacebookId', 'AccountId'] };
		const paths = (lookups?: Set<string>) => {
			const items = builder.buildSelectQuery(query, lookups ? { lookups } : {}).columns.items;
			return [
				items.FacebookId!.expression.columnPath,
				items.AccountId!.expression.columnPath,
			];
		};
		expect(paths()).toEqual(['Facebook.Id', 'Account.Id']); // no schema: the heuristic
		expect(paths(new Set(['Account']))).toEqual(['FacebookId', 'Account.Id']);
	});

	// A content column (a file's `Data`) can be megabytes per row: the expansion never selects it.
	it('expands without binary content columns', async () => {
		const { client, calls } = makeHttpClientHarness((url) =>
			url.endsWith('/RuntimeEntitySchemaRequest')
				? jsonResponse({
						success: true,
						schema: {
							name: 'AccountFile',
							columns: {
								Items: {
									Id: { name: 'Id', dataValueType: DataValueType.Guid },
									Name: { name: 'Name', dataValueType: DataValueType.Text },
									Data: { name: 'Data', dataValueType: DataValueType.Binary },
								},
							},
						},
					})
				: jsonResponse({ success: true, rows: [] }),
		);
		await new DataServiceCrudProvider(client).read({
			entity: 'AccountFile',
			order: [{ field: 'Name', dir: 'asc' }],
		});
		const select = bodyOf(calls.find((c) => c.url.endsWith('/SelectQuery'))!) as any;
		expect(Object.keys(select.columns.items)).toEqual(['Id', 'Name']);
	});

	it('leaves an unordered all-columns read in all-columns mode (no schema fetch)', async () => {
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({ success: true, rows: [] }),
		);
		await new DataServiceCrudProvider(client).read({ entity: 'Contact' });
		expect(calls).toHaveLength(1);
		expect((bodyOf(calls[0]!) as any).allColumns).toBe(true);
	});
});
