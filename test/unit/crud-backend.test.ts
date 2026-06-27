import { describe, expect, it } from 'vitest';

import {
	DataServiceCrudProvider,
	DataServiceQueryBuilder,
	ExpressionType,
	ODataCrudProvider,
	OrderDirection,
	createCrudProvider,
} from '../../src/creatio';

// The factory only needs object identity for these deps; no network is touched.
const deps = { client: {} as never, metadataStore: {} as never };

describe('createCrudProvider (backend selection seam)', () => {
	it('defaults to the OData provider when backend is undefined', () => {
		const provider = createCrudProvider(undefined, deps);
		expect(provider).toBeInstanceOf(ODataCrudProvider);
		expect(provider.kind).toBe('creatio-odata');
	});

	it('returns the OData provider for "odata"', () => {
		expect(createCrudProvider('odata', deps)).toBeInstanceOf(ODataCrudProvider);
	});

	it('returns the DataService skeleton for "dataservice"', () => {
		const provider = createCrudProvider('dataservice', deps);
		expect(provider).toBeInstanceOf(DataServiceCrudProvider);
		expect(provider.kind).toBe('creatio-dataservice');
	});
});

describe('DataServiceCrudProvider skeleton', () => {
	it('fails fast with a clear, greppable error on every CRUD op', async () => {
		const provider = new DataServiceCrudProvider({} as never);
		for (const call of [
			() => provider.listEntitySets(),
			() => provider.describeEntity('Contact'),
			() => provider.read({ entity: 'Contact' }),
			() => provider.create({ entity: 'Contact', data: {} }),
			() => provider.update({ entity: 'Contact', id: '1', data: {} }),
			() => provider.delete({ entity: 'Contact', id: '1' }),
		]) {
			await expect(Promise.resolve().then(call)).rejects.toThrow(
				/dataservice_not_implemented/,
			);
		}
	});
});

describe('DataServiceQueryBuilder (groundwork)', () => {
	const builder = new DataServiceQueryBuilder();

	it('maps selected columns to a column item map and disables allColumns', () => {
		const q = builder.buildSelectQuery({ entity: 'Contact', columns: ['Name', 'Email'] });
		expect(q.rootSchemaName).toBe('Contact');
		expect(q.allColumns).toBe(false);
		expect(Object.keys(q.columns.items)).toEqual(['Name', 'Email']);
		expect(q.columns.items.Name.expression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'Name',
		});
	});

	it('sets allColumns when no columns are provided', () => {
		const q = builder.buildSelectQuery({ entity: 'Contact' });
		expect(q.allColumns).toBe(true);
		expect(Object.keys(q.columns.items)).toHaveLength(0);
	});

	it('translates top/skip to rowCount/rowsOffset + pageable', () => {
		const q = builder.buildSelectQuery({
			entity: 'Contact',
			columns: ['Name'],
			top: 25,
			skip: 50,
		});
		expect(q.rowCount).toBe(25);
		expect(q.isPageable).toBe(true);
		expect(q.rowsOffset).toBe(50);
	});

	it('maps neutral order terms onto the matching columns with direction + position', () => {
		const q = builder.buildSelectQuery({
			entity: 'Contact',
			columns: ['Name', 'CreatedOn'],
			order: [
				{ field: 'CreatedOn', dir: 'desc' },
				{ field: 'Name', dir: 'asc' },
			],
		});
		expect(q.columns.items.CreatedOn.orderDirection).toBe(OrderDirection.Descending);
		expect(q.columns.items.CreatedOn.orderPosition).toBe(1);
		expect(q.columns.items.Name.orderDirection).toBe(OrderDirection.Ascending);
		expect(q.columns.items.Name.orderPosition).toBe(2);
	});

	it('translates a structured filter into a Filters tree on the SelectQuery', () => {
		const q = builder.buildSelectQuery({
			entity: 'Contact',
			columns: ['Name'],
			filter: { kind: 'group', logic: 'and', items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }] },
		});
		// A single-child group collapses to the bare compare filter, carrying the root schema.
		expect(q.filters?.rootSchemaName).toBe('Contact');
		expect(q.filters?.leftExpression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'Name',
		});
	});
});
