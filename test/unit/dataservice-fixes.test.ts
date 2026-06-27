import { describe, expect, it } from 'vitest';

import {
	DataServiceCrudProvider,
	DataValueType,
	FilterComparisonType,
	toParameterDataValueType,
} from '../../src/creatio';

/** Fake CreatioHttpClient that replays queued responses and records POSTed payloads. */
function makeClient(responses: any[]) {
	const calls: Array<{ url: string; body: any }> = [];
	let i = 0;
	const client = {
		normalizedBaseUrl: 'https://t',
		async createPostRequest(body: unknown) {
			return { method: 'POST', body: JSON.stringify(body) };
		},
		async fetchWithAuth(url: string, initFactory: () => Promise<any>) {
			const init = await initFactory();
			calls.push({ url, body: JSON.parse(init.body) });
			const body = responses[i++] ?? {};
			return { ok: true, status: 200, async json() { return body; } } as never;
		},
		async request(_op: string, _url: string, build: () => Promise<any>, onSuccess: any) {
			return onSuccess(await build(), 1);
		},
		logSuccess() {},
	};
	return { client, calls };
}

// Regression locks for the live-found DataService bugs.

describe('FilterComparisonType wire values (locked to core EntitySchemaQueryFilter.cs)', () => {
	it('matches the platform numeric values', () => {
		expect(FilterComparisonType.IsNull).toBe(1);
		expect(FilterComparisonType.IsNotNull).toBe(2);
		expect(FilterComparisonType.Equal).toBe(3);
		expect(FilterComparisonType.NotEqual).toBe(4);
		expect(FilterComparisonType.Less).toBe(5);
		expect(FilterComparisonType.LessOrEqual).toBe(6);
		expect(FilterComparisonType.Greater).toBe(7);
		expect(FilterComparisonType.GreaterOrEqual).toBe(8);
		expect(FilterComparisonType.StartWith).toBe(9);
		expect(FilterComparisonType.Contain).toBe(11);
		expect(FilterComparisonType.EndWith).toBe(13);
	});
});

describe('toParameterDataValueType (extended column type -> base parameter type)', () => {
	it('maps text-family types to Text', () => {
		for (const t of [1, 24, 27, 28, 29, 30, 42, 43, 44, 45]) {
			expect(toParameterDataValueType(t)).toBe(DataValueType.Text);
		}
	});
	it('maps numeric / money / lookup / binary families', () => {
		expect(toParameterDataValueType(11)).toBe(DataValueType.Integer); // Enum
		expect(toParameterDataValueType(31)).toBe(DataValueType.Float); // Float1
		expect(toParameterDataValueType(48)).toBe(DataValueType.Money); // Money0
		expect(toParameterDataValueType(16)).toBe(DataValueType.Lookup); // ImageLookup
		expect(toParameterDataValueType(25)).toBe(DataValueType.Binary); // File
	});
	it('passes base scalar types through', () => {
		expect(toParameterDataValueType(DataValueType.Guid)).toBe(DataValueType.Guid);
		expect(toParameterDataValueType(DataValueType.DateTime)).toBe(DataValueType.DateTime);
		expect(toParameterDataValueType(DataValueType.Boolean)).toBe(DataValueType.Boolean);
	});
});

describe('DataServiceQueryBuilder select normalization + paging', () => {
	it('aliases by the requested name and normalizes lookup-FK column paths', () => {
		const provider = new DataServiceCrudProvider({} as never);
		const q = provider.buildSelectQuery({ entity: 'Contact', columns: ['Id', 'TypeId', 'Type', 'Type/Name'] });
		expect(Object.keys(q.columns.items)).toEqual(['Id', 'TypeId', 'Type', 'Type/Name']);
		expect(q.columns.items.Id.expression.columnPath).toBe('Id');
		expect(q.columns.items.TypeId.expression.columnPath).toBe('Type.Id'); // scalar FK -> Id path
		expect(q.columns.items.Type.expression.columnPath).toBe('Type'); // bare lookup -> display
		expect(q.columns.items['Type/Name'].expression.columnPath).toBe('Type.Name'); // slash -> dot
	});
	it('does not set rowCount/isPageable for top:0 (DataService rejects FETCH 0)', () => {
		const provider = new DataServiceCrudProvider({} as never);
		const q = provider.buildSelectQuery({ entity: 'Contact', top: 0 });
		expect(q.rowCount).toBeUndefined();
		expect(q.isPageable).toBeUndefined();
	});
});

describe('DataServiceCrudProvider.read fixes', () => {
	it('projects out auto-added columns (e.g. Photo) keeping only requested columns', async () => {
		const { client } = makeClient([{ rows: [{ Id: '1', Name: 'A', Photo: { value: 'x' } }] }]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.read({ entity: 'Contact', columns: ['Id', 'Name'] });
		expect(res.items).toEqual([{ Id: '1', Name: 'A' }]);
	});

	it('top:0 returns no rows WITHOUT sending the row query; still runs the count query', async () => {
		const { client, calls } = makeClient([{ rows: [{ recordsCount: 7 }] }]);
		const provider = new DataServiceCrudProvider(client as never);
		const res = await provider.read({ entity: 'Contact', top: 0, count: true });
		expect(res).toEqual({ items: [], totalCount: 7 });
		expect(calls).toHaveLength(1); // only the COUNT query
		expect(calls[0].body.columns.items.recordsCount).toBeDefined();
	});
});

describe('DataServiceCrudProvider.listEntitySets dedupes by name', () => {
	it('collapses duplicate Names from the workspace view', async () => {
		const { client } = makeClient([
			{ rows: [{ Name: 'Account' }, { Name: 'MktgActivity' }, { Name: 'MktgActivity' }, { Name: 'Contact' }] },
		]);
		const provider = new DataServiceCrudProvider(client as never);
		expect(await provider.listEntitySets()).toEqual(['Account', 'MktgActivity', 'Contact']);
	});
});

describe('DataServiceCrudProvider.create coercion + FK column mapping', () => {
	const schemaResponse = {
		success: true,
		schema: {
			name: 'Contact',
			columns: {
				Items: {
					Name: { name: 'Name', dataValueType: 28 }, // MediumText (extended)
					Type: { name: 'Type', dataValueType: DataValueType.Lookup },
				},
			},
		},
	};

	it('maps extended text type to Text and a scalar FK key to the lookup column with a Guid value', async () => {
		const { client, calls } = makeClient([schemaResponse, { success: true, id: 'new' }]);
		const provider = new DataServiceCrudProvider(client as never);
		await provider.create({
			entity: 'Contact',
			data: { Name: 'Bob', TypeId: '60733efc-f36b-1410-a883-16d83cab0980' },
		});
		const insert = calls[1].body;
		// MediumText(28) coerced to base Text(1):
		expect(insert.columnValues.items.Name.parameter.dataValueType).toBe(DataValueType.Text);
		// TypeId -> logical lookup column "Type", written as a Guid id:
		expect(insert.columnValues.items.TypeId).toBeUndefined();
		expect(insert.columnValues.items.Type.parameter.dataValueType).toBe(DataValueType.Guid);
	});
});

describe('encodeParameterValue date/time encoding (devkit ɵencodeDate parity)', () => {
	it('quotes and strips Z/offset for date-time values', async () => {
		const { encodeParameterValue } = await import('../../src/creatio');
		expect(encodeParameterValue(DataValueType.DateTime, '2026-06-01T00:00:00Z')).toBe(
			'"2026-06-01T00:00:00"',
		);
		expect(encodeParameterValue(DataValueType.DateTime, '2026-06-01T10:00:00+03:00')).toBe(
			'"2026-06-01T10:00:00"',
		);
		expect(encodeParameterValue(DataValueType.Date, '2026-06-01')).toBe('"2026-06-01"');
	});
	it('leaves non-temporal values untouched', async () => {
		const { encodeParameterValue } = await import('../../src/creatio');
		expect(encodeParameterValue(DataValueType.Text, 'Bob')).toBe('Bob');
		expect(encodeParameterValue(DataValueType.Integer, 5)).toBe(5);
	});
});
