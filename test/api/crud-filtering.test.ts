import { describe, expect, it } from 'vitest';

import {
	CreatioEngineManager,
	DataServiceCrudProvider,
	DataValueType,
	ExpressionType,
	FilterComparisonType,
	FilterType,
	LogicalOperation,
	ODataCrudProvider,
} from '../../src/creatio';
import { Server } from '../../src/server/mcp';
import { makeFakeContext } from '../support/fake-context';

/**
 * Full-stack CRUD/filtering integration: drives the real `read` tool through the Server →
 * CrudEngine → real provider → query translator, and asserts the OUTBOUND query for BOTH
 * backends. This is the cross-backend "does the neutral filter contract translate correctly"
 * safety net (no live Creatio needed — only the HTTP boundary is faked to capture the query).
 */

const GUID = '8ecab4a1-0ca3-4515-9399-efe0a19390bd';
const GUID2 = '11111111-2222-3333-4444-555555555555';

type ReadHandler = (args: unknown) => Promise<unknown>;

function serverFor(crud: unknown): ReadHandler {
	const context = makeFakeContext();
	(context as { crud: unknown }).crud = crud;
	const engines = new CreatioEngineManager(context as never);
	const server = new Server(engines, { readonlyMode: false });
	const handlers = (server as unknown as { _handlers: Map<string, ReadHandler> })._handlers;
	return (args) => handlers.get('read')!(args);
}

// ----------------------------- OData backend -----------------------------

/** Build a Server backed by a real ODataCrudProvider; capture the request URL. */
function odataHarness() {
	const captured: { url?: string } = {};
	const client = {
		normalizedBaseUrl: 'https://t',
		async getJsonHeaders() {
			return {};
		},
		async fetchJson(url: string) {
			captured.url = url;
			return { value: [] };
		},
	};
	const provider = new ODataCrudProvider(client as never, {} as never);
	return { read: serverFor(provider), captured };
}

/** Decode the `$filter` clause out of a captured OData URL. */
function odataFilter(url: string | undefined): string | undefined {
	const m = /\$filter=([^&]*)/.exec(url ?? '');
	return m ? decodeURIComponent(m[1]) : undefined;
}

describe('OData backend — read filter translation (full stack)', () => {
	async function filterFor(filters: unknown): Promise<string | undefined> {
		const { read, captured } = odataHarness();
		await read({ entity: 'Contact', filters });
		return odataFilter(captured.url);
	}

	it('by string', async () => {
		expect(await filterFor({ all: [{ field: 'Name', op: 'eq', value: 'Bob' }] })).toBe(
			"Name eq 'Bob'",
		);
	});

	it('by number', async () => {
		expect(await filterFor({ all: [{ field: 'Amount', op: 'gt', value: 100 }] })).toBe(
			'Amount gt 100',
		);
	});

	it('by boolean', async () => {
		expect(await filterFor({ all: [{ field: 'IsActive', op: 'eq', value: true }] })).toBe(
			'IsActive eq true',
		);
	});

	it('by primary-key GUID (bare, unquoted)', async () => {
		expect(await filterFor({ all: [{ field: 'Id', op: 'eq', value: GUID }] })).toBe(
			`Id eq ${GUID}`,
		);
	});

	it('by date — ISO literal emitted UNQUOTED (OData v4 requires it; live 400 otherwise)', async () => {
		expect(await filterFor({ all: [{ field: 'CreatedOn', op: 'ge', value: '2026-01-01' }] })).toBe(
			'CreatedOn ge 2026-01-01',
		);
		expect(
			await filterFor({ all: [{ field: 'CreatedOn', op: 'ge', value: '2026-06-01T00:00:00Z' }] }),
		).toBe('CreatedOn ge 2026-06-01T00:00:00Z');
	});

	it('by direct relation — navigation by name', async () => {
		expect(await filterFor({ all: [{ field: 'Contact/Name', op: 'eq', value: 'Acme' }] })).toBe(
			"Contact/Name eq 'Acme'",
		);
	});

	it('by direct relation — scalar FK GUID auto-navigated to <Lookup>/Id', async () => {
		expect(await filterFor({ all: [{ field: 'ContactId', op: 'eq', value: GUID }] })).toBe(
			`Contact/Id eq ${GUID}`,
		);
	});

	it('text functions — contains / startswith / endswith', async () => {
		expect(await filterFor({ all: [{ field: 'Name', op: 'contains', value: 'Ac' }] })).toBe(
			"contains(Name,'Ac')",
		);
		expect(await filterFor({ all: [{ field: 'Name', op: 'startswith', value: 'Ac' }] })).toBe(
			"startswith(Name,'Ac')",
		);
		expect(await filterFor({ all: [{ field: 'Name', op: 'endswith', value: 'me' }] })).toBe(
			"endswith(Name,'me')",
		);
	});

	it('in-list (expanded to OR group, FK values navigated)', async () => {
		expect(await filterFor({ all: [{ field: 'ContactId', in: [GUID, GUID2] }] })).toBe(
			`(Contact/Id eq ${GUID} or Contact/Id eq ${GUID2})`,
		);
	});

	it('null comparison', async () => {
		expect(await filterFor({ all: [{ field: 'Email', op: 'eq', value: null }] })).toBe(
			'Email eq null',
		);
	});

	it('combined AND + OR groups', async () => {
		expect(
			await filterFor({
				all: [{ field: 'A', op: 'eq', value: 1 }],
				any: [
					{ field: 'B', op: 'eq', value: 2 },
					{ field: 'C', op: 'eq', value: 3 },
				],
			}),
		).toBe('(A eq 1 and (B eq 2 or C eq 3))');
	});

	it('carries select / orderBy / top / skip into the query string', async () => {
		const { read, captured } = odataHarness();
		await read({
			entity: 'Order',
			select: ['Id', 'Amount'],
			orderBy: 'Amount desc, Number asc',
			top: 25,
			skip: 50,
		});
		const url = captured.url ?? '';
		expect(url).toContain('$select=' + encodeURIComponent('Id,Amount'));
		expect(url).toContain('$orderby=' + encodeURIComponent('Amount desc, Number asc'));
		expect(url).toContain('$top=25');
		expect(url).toContain('$skip=50');
	});
});

// --------------------------- DataService backend ---------------------------

/** Build a Server backed by a real DataServiceCrudProvider; capture the SelectQuery payload. */
function dataServiceHarness() {
	const captured: { body?: any } = {};
	const client = {
		normalizedBaseUrl: 'https://t',
		async createPostRequest(body: unknown) {
			return { method: 'POST', body: JSON.stringify(body) };
		},
		async fetchWithAuth(_url: string, initFactory: () => Promise<any>) {
			const init = await initFactory();
			captured.body = JSON.parse(init.body);
			return { ok: true, status: 200, async json() { return { rows: [] }; } } as never;
		},
		async request(_op: string, _url: string, build: () => Promise<any>, onSuccess: any) {
			return onSuccess(await build(), 1);
		},
		logSuccess() {},
	};
	const provider = new DataServiceCrudProvider(client as never);
	return { read: serverFor(provider), captured };
}

describe('DataService backend — read filter translation (full stack)', () => {
	async function filtersFor(filters: unknown): Promise<any> {
		const { read, captured } = dataServiceHarness();
		await read({ entity: 'Contact', filters });
		return captured.body.filters;
	}

	it('by string -> Text compare', async () => {
		const f = await filtersFor({ all: [{ field: 'Name', op: 'eq', value: 'Bob' }] });
		expect(f).toMatchObject({
			filterType: FilterType.CompareFilter,
			comparisonType: FilterComparisonType.Equal,
			leftExpression: { expressionType: ExpressionType.SchemaColumn, columnPath: 'Name' },
			rightExpression: {
				expressionType: ExpressionType.Parameter,
				parameter: { dataValueType: DataValueType.Text, value: 'Bob' },
			},
		});
	});

	it('by number -> Integer, with the right comparison', async () => {
		const f = await filtersFor({ all: [{ field: 'Amount', op: 'gt', value: 100 }] });
		expect(f.comparisonType).toBe(FilterComparisonType.Greater);
		expect(f.rightExpression.parameter).toEqual({ dataValueType: DataValueType.Integer, value: 100 });
	});

	it('by boolean -> Boolean', async () => {
		const f = await filtersFor({ all: [{ field: 'IsActive', op: 'eq', value: true }] });
		expect(f.rightExpression.parameter).toEqual({ dataValueType: DataValueType.Boolean, value: true });
	});

	it('by primary-key GUID -> Guid', async () => {
		const f = await filtersFor({ all: [{ field: 'Id', op: 'eq', value: GUID }] });
		expect(f.leftExpression.columnPath).toBe('Id');
		expect(f.rightExpression.parameter).toEqual({ dataValueType: DataValueType.Guid, value: GUID });
	});

	it('by date -> DateTime', async () => {
		const f = await filtersFor({ all: [{ field: 'CreatedOn', op: 'ge', value: '2026-01-01' }] });
		expect(f.comparisonType).toBe(FilterComparisonType.GreaterOrEqual);
		expect(f.rightExpression.parameter.dataValueType).toBe(DataValueType.DateTime);
	});

	it('by direct relation — navigation by name (slash -> dot path)', async () => {
		const f = await filtersFor({ all: [{ field: 'Contact/Name', op: 'eq', value: 'Acme' }] });
		expect(f.leftExpression.columnPath).toBe('Contact.Name');
		expect(f.rightExpression.parameter.dataValueType).toBe(DataValueType.Text);
	});

	it('by direct relation — scalar FK GUID -> <Lookup>.Id path, Guid value', async () => {
		const f = await filtersFor({ all: [{ field: 'ContactId', op: 'eq', value: GUID }] });
		expect(f.leftExpression.columnPath).toBe('Contact.Id');
		expect(f.rightExpression.parameter.dataValueType).toBe(DataValueType.Guid);
	});

	it('text functions map to Contain / StartWith / EndWith', async () => {
		expect((await filtersFor({ all: [{ field: 'Name', op: 'contains', value: 'Ac' }] })).comparisonType).toBe(
			FilterComparisonType.Contain,
		);
		expect((await filtersFor({ all: [{ field: 'Name', op: 'startswith', value: 'Ac' }] })).comparisonType).toBe(
			FilterComparisonType.StartWith,
		);
		expect((await filtersFor({ all: [{ field: 'Name', op: 'endswith', value: 'me' }] })).comparisonType).toBe(
			FilterComparisonType.EndWith,
		);
	});

	it('in-list -> OR group of equalities (each FK navigated)', async () => {
		const f = await filtersFor({ all: [{ field: 'ContactId', in: [GUID, GUID2] }] });
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.Or);
		expect(Object.keys(f.items)).toHaveLength(2);
		expect(f.items.item1.leftExpression.columnPath).toBe('Contact.Id');
	});

	it('null comparison -> IsNullFilter', async () => {
		const f = await filtersFor({ all: [{ field: 'Email', op: 'eq', value: null }] });
		expect(f.filterType).toBe(FilterType.IsNullFilter);
		expect(f.comparisonType).toBe(FilterComparisonType.IsNull);
	});

	it('combined AND + OR -> nested Group tree', async () => {
		const f = await filtersFor({
			all: [{ field: 'A', op: 'eq', value: 1 }],
			any: [
				{ field: 'B', op: 'eq', value: 2 },
				{ field: 'C', op: 'eq', value: 3 },
			],
		});
		expect(f.filterType).toBe(FilterType.Group);
		expect(f.logicalOperation).toBe(LogicalOperation.And);
		expect(f.items.item1.leftExpression.columnPath).toBe('A'); // collapsed single-child all-group
		expect(f.items.item2.filterType).toBe(FilterType.Group);
		expect(f.items.item2.logicalOperation).toBe(LogicalOperation.Or);
	});

	it('carries columns / order / paging onto the SelectQuery', async () => {
		const { read, captured } = dataServiceHarness();
		await read({ entity: 'Order', select: ['Id', 'Amount'], orderBy: 'Amount desc', top: 25, skip: 50 });
		const q = captured.body;
		expect(Object.keys(q.columns.items)).toEqual(['Id', 'Amount']);
		expect(q.columns.items.Amount.orderDirection).toBe(2); // Descending
		expect(q.rowCount).toBe(25);
		expect(q.rowsOffset).toBe(50);
	});

	it('does NOT accept OData-only params (filter/expand are not registered)', async () => {
		const { read, captured } = dataServiceHarness();
		await read({ entity: 'Contact', filter: 'IsActive eq true', expand: ['Account'] });
		// stripped by the schema -> no filters, all columns
		expect(captured.body.filters).toBeUndefined();
		expect(captured.body.allColumns).toBe(true);
	});
});

// --------------------------- write path (both backends) ---------------------------

describe('write path — full stack', () => {
	it('OData: create POSTs JSON to the entity URL', async () => {
		const captured: { url?: string; init?: any } = {};
		const client = {
			normalizedBaseUrl: 'https://t',
			async getJsonHeaders() { return {}; },
			async getPostHeaders() { return { 'Content-Type': 'application/json' }; },
			async fetchWithAuth(url: string, initFactory: () => Promise<any>) {
				captured.url = url;
				captured.init = await initFactory();
				return { ok: true, status: 201, async json() { return { Id: 'new' }; }, async text() { return ''; } } as never;
			},
			async request(_op: string, _url: string, build: () => Promise<any>, onSuccess: any) {
				return onSuccess(await build(), 1);
			},
			logSuccess() {},
		};
		const read = serverFor(new ODataCrudProvider(client as never, {} as never));
		void read; // server also wires create
		const context = makeFakeContext();
		(context as { crud: unknown }).crud = new ODataCrudProvider(client as never, {} as never);
		const engines = new CreatioEngineManager(context as never);
		const server = new Server(engines, { readonlyMode: false });
		const handlers = (server as unknown as { _handlers: Map<string, ReadHandler> })._handlers;
		await handlers.get('create')!({ entity: 'Contact', data: { Name: 'X' } });
		expect(captured.url).toBe('https://t/0/odata/Contact');
		expect(captured.init.method).toBe('POST');
		expect(JSON.parse(captured.init.body)).toEqual({ Name: 'X' });
	});

	it('DataService: update sends UpdateQuery with ColumnValues + id Filters', async () => {
		const calls: Array<{ url: string; body: any }> = [];
		const responses = [
			{ success: true, schema: { name: 'Contact', columns: { Items: { Name: { name: 'Name', dataValueType: DataValueType.Text } } } } },
			{ success: true, rowsAffected: 1 },
		];
		let i = 0;
		const client = {
			normalizedBaseUrl: 'https://t',
			async createPostRequest(body: unknown) { return { method: 'POST', body: JSON.stringify(body) }; },
			async fetchWithAuth(url: string, initFactory: () => Promise<any>) {
				const init = await initFactory();
				calls.push({ url, body: JSON.parse(init.body) });
				return { ok: true, status: 200, async json() { return responses[i++] ?? {}; } } as never;
			},
			async request(_op: string, _url: string, build: () => Promise<any>, onSuccess: any) {
				return onSuccess(await build(), 1);
			},
			logSuccess() {},
		};
		const context = makeFakeContext();
		(context as { crud: unknown }).crud = new DataServiceCrudProvider(client as never);
		const engines = new CreatioEngineManager(context as never);
		const server = new Server(engines, { readonlyMode: false });
		const handlers = (server as unknown as { _handlers: Map<string, ReadHandler> })._handlers;
		await handlers.get('update')!({ entity: 'Contact', id: GUID, data: { Name: 'Y' } });
		const update = calls[1].body;
		expect(update.url ?? calls[1].url).toContain('/UpdateQuery');
		expect(update.columnValues.items.Name.parameter).toEqual({ dataValueType: DataValueType.Text, value: 'Y' });
		expect(update.filters.leftExpression.columnPath).toBe('Id');
		expect(update.filters.rightExpression.parameter.value).toBe(GUID);
	});
});
