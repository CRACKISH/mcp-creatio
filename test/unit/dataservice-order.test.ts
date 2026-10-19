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

	it('uses expanded schema column names as-is (a real `TimeZoneId` is not a lookup path)', () => {
		const builder = new DataServiceQueryBuilder();
		const query = { entity: 'Contact', columns: ['TimeZoneId'] };
		expect(
			builder.buildSelectQuery(query).columns.items.TimeZoneId!.expression.columnPath,
		).toBe('TimeZone.Id');
		expect(
			builder.buildSelectQuery(query, { exactColumns: true }).columns.items.TimeZoneId!
				.expression.columnPath,
		).toBe('TimeZoneId');
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
