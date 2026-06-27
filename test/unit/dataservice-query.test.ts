import { describe, expect, it } from 'vitest';

import {
	AggregationType,
	DataServiceCrudProvider,
	DataServiceFilterTranslator,
	DataValueType,
	ExpressionType,
	FilterComparisonType,
	FilterType,
	LogicalOperation,
	inferDataValueType,
} from '../../src/creatio';
import type { FilterNode } from '../../src/creatio';

/** Fake CreatioHttpClient that records POSTed DataService payloads and returns canned bodies. */
function makeClient(responses: any[]) {
	const calls: Array<{ url: string; body: any }> = [];
	let i = 0;
	const client = {
		normalizedBaseUrl: 'https://tenant',
		async createPostRequest(body: unknown) {
			return { method: 'POST', body: JSON.stringify(body) };
		},
		async fetchWithAuth(url: string, initFactory: () => Promise<any>) {
			const init = await initFactory();
			calls.push({ url, body: JSON.parse(init.body) });
			const body = responses[i++] ?? {};
			return { ok: true, status: 200, async json() { return body; } } as never;
		},
		async request(_op: string, _url: string, buildRequest: () => Promise<any>, onSuccess: any) {
			return onSuccess(await buildRequest(), 1);
		},
		logSuccess() {},
	};
	return { client, calls };
}

const GUID = '11111111-2222-3333-4444-555555555555';

describe('inferDataValueType (heuristic fallback)', () => {
	it('maps JS values + GUID/ISO strings to Terrasoft data value types', () => {
		expect(inferDataValueType('IsActive', true)).toBe(DataValueType.Boolean);
		expect(inferDataValueType('Count', 5)).toBe(DataValueType.Integer);
		expect(inferDataValueType('Amount', 5.5)).toBe(DataValueType.Float);
		expect(inferDataValueType('ContactId', GUID)).toBe(DataValueType.Guid);
		expect(inferDataValueType('CreatedOn', '2026-06-27T00:00:00Z')).toBe(DataValueType.DateTime);
		expect(inferDataValueType('Name', 'Bob')).toBe(DataValueType.Text);
	});
});

describe('DataServiceFilterTranslator', () => {
	const t = new DataServiceFilterTranslator();

	it('translates a single compare into a typed CompareFilter carrying the root schema', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
		};
		const f = t.translate('Contact', node)!;
		expect(f.rootSchemaName).toBe('Contact');
		expect(f.filterType).toBe(FilterType.CompareFilter);
		expect(f.comparisonType).toBe(FilterComparisonType.Equal);
		expect(f.leftExpression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'Name',
		});
		expect(f.rightExpression).toEqual({
			expressionType: ExpressionType.Parameter,
			parameter: { dataValueType: DataValueType.Text, value: 'Bob' },
		});
	});

	it('builds a logical Group with keyed items for multiple conditions', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'or',
			items: [
				{ kind: 'condition', field: 'A', op: 'eq', value: 1 },
				{ kind: 'condition', field: 'B', op: 'gt', value: 2 },
			],
		};
		const f = t.translate('X', node)!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.Or);
		expect(Object.keys(f.items!)).toEqual(['item1', 'item2']);
		expect(f.items!.item2.comparisonType).toBe(FilterComparisonType.Greater);
	});

	it('renders isNull / isNotNull as IsNullFilter without a right expression', () => {
		const isNull = t.translate('X', { kind: 'condition', field: 'Y', op: 'isNull' })!;
		expect(isNull.filterType).toBe(FilterType.IsNullFilter);
		expect(isNull.comparisonType).toBe(FilterComparisonType.IsNull);
		expect(isNull.rightExpression).toBeUndefined();
		const notNull = t.translate('X', { kind: 'condition', field: 'Y', op: 'isNotNull' })!;
		expect(notNull.comparisonType).toBe(FilterComparisonType.IsNotNull);
	});

	it('expands an in-list into an OR group of equalities', () => {
		const f = t.translate('X', { kind: 'in', field: 'S', values: ['a', 'b'] })!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.Or);
		expect(Object.keys(f.items!)).toHaveLength(2);
		expect(f.items!.item1.leftExpression).toEqual({
			expressionType: ExpressionType.SchemaColumn,
			columnPath: 'S',
		});
	});

	it('types a GUID right-side parameter as Guid and a contains as Text', () => {
		const eq = t.translate('X', { kind: 'condition', field: 'ContactId', op: 'eq', value: GUID })!;
		expect(eq.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Guid, value: GUID },
		});
		const contains = t.translate('X', {
			kind: 'condition',
			field: 'Name',
			op: 'contains',
			value: 'ac',
		})!;
		expect(contains.comparisonType).toBe(FilterComparisonType.Contain);
		expect(contains.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Text },
		});
	});

	it('supports nested groups (AND of OR)', () => {
		const node: FilterNode = {
			kind: 'group',
			logic: 'and',
			items: [
				{
					kind: 'group',
					logic: 'or',
					items: [
						{ kind: 'condition', field: 'A', op: 'eq', value: 1 },
						{ kind: 'condition', field: 'B', op: 'eq', value: 2 },
					],
				},
				{ kind: 'condition', field: 'C', op: 'eq', value: 3 },
			],
		};
		const f = t.translate('X', node)!;
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.And);
		expect(f.items!.item1.filterType).toBe(FilterType.Group);
		expect(f.items!.item1.logicalOperation).toBe(LogicalOperation.Or);
		expect(f.items!.item2.filterType).toBe(FilterType.CompareFilter);
	});

	it('returns undefined for an empty tree', () => {
		expect(t.translate('X', undefined)).toBeUndefined();
		expect(t.translate('X', { kind: 'group', logic: 'and', items: [] })).toBeUndefined();
	});

	it('uses an injected schema-aware resolver for parameter typing', () => {
		const resolver = () => DataValueType.Lookup;
		const lt = new DataServiceFilterTranslator(resolver);
		const f = lt.translate('X', { kind: 'condition', field: 'Contact', op: 'eq', value: GUID })!;
		expect(f.rightExpression).toMatchObject({
			parameter: { dataValueType: DataValueType.Lookup },
		});
	});
});

describe('DataServiceCrudProvider.read (transport)', () => {
	const GUID2 = '11111111-2222-3333-4444-555555555555';

	it('POSTs a SelectQuery to the DataService endpoint and normalizes rows to items', async () => {
		const { client, calls } = makeClient([{ rows: [{ Id: '1' }, { Id: '2' }] }]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.read({ entity: 'Contact', columns: ['Id'] });
		expect(res).toEqual({ items: [{ Id: '1' }, { Id: '2' }] });
		expect(calls[0].url).toBe('https://tenant/0/DataService/json/SyncReply/SelectQuery');
		expect(calls[0].body.rootSchemaName).toBe('Contact');
		expect(Object.keys(calls[0].body.columns.items)).toEqual(['Id']);
	});

	it('translates a structured filter into the SelectQuery Filters tree', async () => {
		const { client, calls } = makeClient([{ rows: [] }]);
		const provider = new DataServiceCrudProvider(client as never);
		await provider.read({
			entity: 'Opportunity',
			filter: { kind: 'group', logic: 'and', items: [{ kind: 'condition', field: 'ContactId', op: 'eq', value: GUID2 }] },
		});
		expect(calls[0].body.filters.rootSchemaName).toBe('Opportunity');
		expect(calls[0].body.filters.rightExpression.parameter.dataValueType).toBe(DataValueType.Guid);
	});

	it('issues a second COUNT aggregation query when count is requested', async () => {
		const { client, calls } = makeClient([
			{ rows: [{ Id: '1' }] },
			{ rows: [{ recordsCount: 42 }] },
		]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.read({ entity: 'Contact', count: true });
		expect(res).toEqual({ items: [{ Id: '1' }], totalCount: 42 });
		expect(calls).toHaveLength(2);
		expect(calls[1].body.columns.items.recordsCount.expression.aggregationType).toBe(
			AggregationType.Count,
		);
	});

	it('rejects an invalid entity name before any request', async () => {
		const { client, calls } = makeClient([]);
		const provider = new DataServiceCrudProvider(client as never);
		await expect(provider.read({ entity: '../Hack' })).rejects.toThrow(/invalid_entity_name/);
		expect(calls).toHaveLength(0);
	});
});
