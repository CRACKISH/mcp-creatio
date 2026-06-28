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
			return {
				ok: true,
				status: 200,
				async json() {
					return body;
				},
			} as never;
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
		expect(inferDataValueType('CreatedOn', '2026-06-27T00:00:00Z')).toBe(
			DataValueType.DateTime,
		);
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
		expect(isNull.isNull).toBe(true);
		expect(isNull.rightExpression).toBeUndefined();
		const notNull = t.translate('X', { kind: 'condition', field: 'Y', op: 'isNotNull' })!;
		expect(notNull.comparisonType).toBe(FilterComparisonType.IsNotNull);
		// The IsNull flag must be explicit (server default is true → would invert isNotNull).
		expect(notNull.isNull).toBe(false);
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
		const eq = t.translate('X', {
			kind: 'condition',
			field: 'ContactId',
			op: 'eq',
			value: GUID,
		})!;
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

	it('normalizes OData-style field paths to DataService column paths', () => {
		const nav = t.translate('X', {
			kind: 'condition',
			field: 'Contact/Name',
			op: 'eq',
			value: 'Bob',
		})!;
		expect(nav.leftExpression).toMatchObject({ columnPath: 'Contact.Name' });
		// scalar lookup FK compared to a GUID -> navigate to the lookup primary key
		const fk = t.translate('X', {
			kind: 'condition',
			field: 'ContactId',
			op: 'eq',
			value: GUID,
		})!;
		expect(fk.leftExpression).toMatchObject({ columnPath: 'Contact.Id' });
	});

	it('uses an injected schema-aware resolver for parameter typing', () => {
		const resolver = () => DataValueType.Lookup;
		const lt = new DataServiceFilterTranslator(resolver);
		const f = lt.translate('X', {
			kind: 'condition',
			field: 'Contact',
			op: 'eq',
			value: GUID,
		})!;
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
			filter: {
				kind: 'group',
				logic: 'and',
				items: [{ kind: 'condition', field: 'ContactId', op: 'eq', value: GUID2 }],
			},
		});
		expect(calls[0].body.filters.rootSchemaName).toBe('Opportunity');
		expect(calls[0].body.filters.rightExpression.parameter.dataValueType).toBe(
			DataValueType.Guid,
		);
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

describe('DataServiceCrudProvider schema (RuntimeEntitySchemaRequest / VwSysSchemaInWorkspace)', () => {
	const schemaResponse = {
		success: true,
		schema: {
			name: 'Contact',
			primaryColumnUId: 'pk',
			columns: {
				Items: {
					Id: {
						uId: 'pk',
						name: 'Id',
						dataValueType: DataValueType.Guid,
						isRequired: true,
					},
					Name: { name: 'Name', dataValueType: DataValueType.Text, isRequired: false },
					Account: {
						name: 'Account',
						dataValueType: DataValueType.Lookup,
						referenceSchemaName: 'Account',
					},
				},
			},
		},
	};

	it('lists entity sets via a DISTINCT VwSysSchemaInWorkspace SelectQuery', async () => {
		const { client, calls } = makeClient([
			{
				rows: [
					{ Name: 'Account', Caption: 'Accounts' },
					{ Name: 'Contact', Caption: 'Contacts' },
				],
			},
		]);
		const provider = new DataServiceCrudProvider(client as never);
		const names = await provider.listEntitySets();
		expect(names).toEqual(['Account', 'Contact']);
		expect(calls[0].body.rootSchemaName).toBe('VwSysSchemaInWorkspace');
		expect(calls[0].body.isDistinct).toBe(true);
		expect(calls[0].body.filters.leftExpression.columnPath).toBe('ManagerName');
		expect(calls[0].body.filters.rightExpression.parameter.value).toBe('EntitySchemaManager');
	});

	it('describes an entity from the runtime schema (key + typed properties)', async () => {
		const { client, calls } = makeClient([schemaResponse]);
		const provider = new DataServiceCrudProvider(client as never);
		const desc = await provider.describeEntity('Contact');
		expect(calls[0].url).toContain('/RuntimeEntitySchemaRequest');
		expect(calls[0].body).toEqual({ name: 'Contact' });
		expect(desc.entityType).toBe('Contact');
		expect(desc.key).toEqual(['Id']);
		expect(desc.properties).toContainEqual({ name: 'Name', type: 'Text', nullable: true });
	});
});

describe('DataServiceCrudProvider write (Insert/Update/Delete + coercion)', () => {
	const GUID3 = '22222222-2222-3333-4444-555555555555';
	const schemaResponse = {
		success: true,
		schema: {
			name: 'Contact',
			columns: {
				Items: {
					Name: { name: 'Name', dataValueType: DataValueType.Text },
					Account: { name: 'Account', dataValueType: DataValueType.Lookup },
				},
			},
		},
	};

	it('insert types ColumnValues from metadata (Lookup written by id -> Guid)', async () => {
		const { client, calls } = makeClient([
			schemaResponse,
			{ success: true, id: 'new-id', rowsAffected: 1 },
		]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.create({
			entity: 'Contact',
			data: { Name: 'Bob', Account: GUID3 },
		});
		expect(res).toEqual({ id: 'new-id', success: true, rowsAffected: 1 });
		const insert = calls[1].body;
		expect(insert.rootSchemaName).toBe('Contact');
		expect(insert.columnValues.items.Name.parameter).toEqual({
			dataValueType: DataValueType.Text,
			value: 'Bob',
		});
		// Lookup column written with a bare GUID coerces to Guid (sets the FK by id).
		expect(insert.columnValues.items.Account.parameter.dataValueType).toBe(DataValueType.Guid);
	});

	it('insert falls back to the heuristic when metadata has no such column', async () => {
		const { client, calls } = makeClient([
			{ success: true, schema: { name: 'X', columns: { Items: {} } } },
			{ success: true, id: '1' },
		]);
		const provider = new DataServiceCrudProvider(client as never);
		await provider.create({ entity: 'X', data: { IsActive: true } });
		expect(calls[1].body.columnValues.items.IsActive.parameter.dataValueType).toBe(
			DataValueType.Boolean,
		);
	});

	it('update sends ColumnValues + an id Filters and reports success', async () => {
		const { client, calls } = makeClient([schemaResponse, { success: true, rowsAffected: 1 }]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.update({ entity: 'Contact', id: GUID3, data: { Name: 'Y' } });
		expect(res).toEqual({ success: true, rowsAffected: 1 });
		const update = calls[1].body;
		expect(update.filters.leftExpression.columnPath).toBe('Id');
		expect(update.filters.rightExpression.parameter).toEqual({
			dataValueType: DataValueType.Guid,
			value: GUID3,
		});
		expect(update.columnValues.items.Name.parameter.value).toBe('Y');
	});

	it('delete sends only an id Filters (no schema fetch)', async () => {
		const { client, calls } = makeClient([{ success: true, rowsAffected: 1 }]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.delete({ entity: 'Contact', id: GUID3 });
		expect(res).toEqual({ success: true, rowsAffected: 1 });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/DeleteQuery');
		expect(calls[0].body.filters.rightExpression.parameter.value).toBe(GUID3);
	});

	it('surfaces a logical failure (success:false) as an error on writes', async () => {
		const { client } = makeClient([
			schemaResponse,
			{ success: false, responseStatus: { Message: 'boom' } },
		]);
		const provider = new DataServiceCrudProvider(client as never);
		await expect(provider.create({ entity: 'Contact', data: { Name: 'Z' } })).rejects.toThrow(
			/creatio_dataservice_InsertQuery_error:boom/,
		);
	});
});
