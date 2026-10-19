import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CrudProvider,
	DataServiceCrudProvider,
	DataValueType,
	NavigationServiceProvider,
	RecordFilesService,
	UnknownNameError,
} from '../../src/creatio';
import { bodyOf, jsonResponse, makeHttpClientHarness } from '../support/http-client';

const RECORD = '11111111-1111-1111-1111-111111111111';
const FILE_TYPE = '529bc2f8-0ee0-df11-971b-001d60e938c6';
const LINK_TYPE = '539bc2f8-0ee0-df11-971b-001d60e938c6';
const OBJECT_LINK_TYPE = '549bc2f8-0ee0-df11-971b-001d60e938c6';

afterEach(() => vi.unstubAllGlobals());

const navigation = {
	kind: 'nav',
	recordUrl: vi.fn(),
	fileDownloadUrl: (entity: string, id: string) =>
		`https://t/0/rest/FileService/Download/${entity}/${id}`,
};

function crudWith(rows: Record<string, unknown[] | Error>) {
	return {
		kind: 'fake',
		capabilities: { rawFilter: false, expand: false },
		listEntitySets: vi.fn(),
		describeEntity: vi.fn(),
		read: vi.fn(async (query: any) => {
			const result = rows[query.entity] ?? [];
			if (result instanceof Error) throw result;
			return { items: result };
		}),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	};
}

const service = (crud: ReturnType<typeof crudWith>) =>
	new RecordFilesService(crud as unknown as CrudProvider, navigation);

describe('RecordFilesService', () => {
	it('merges both storages newest first, with download links for files and targets for links', async () => {
		const crud = crudWith({
			AccountFile: [
				{
					Id: 'f1',
					Name: 'Contract.pdf',
					TypeId: FILE_TYPE,
					Size: 2048,
					CreatedOn: '2026-01-02T10:00:00',
				},
				{
					Id: 'l1',
					Name: 'https://example.com',
					TypeId: LINK_TYPE,
					Size: 0,
					CreatedOn: '2026-01-01T10:00:00',
				},
			],
			SysFile: [
				{
					Id: 's1',
					Name: 'Card',
					TypeId: OBJECT_LINK_TYPE,
					Size: 0,
					CreatedOn: '2026-01-03T10:00:00',
				},
			],
		});
		const result = await service(crud).listRecordFiles({
			entity: 'Account',
			id: RECORD,
			top: 10,
		});
		expect(result).toEqual({
			files: [
				{
					id: 's1',
					name: 'Card',
					kind: 'object-link',
					size: 0,
					createdOn: '2026-01-03T10:00:00',
					storage: 'SysFile',
				},
				{
					id: 'f1',
					name: 'Contract.pdf',
					kind: 'file',
					size: 2048,
					createdOn: '2026-01-02T10:00:00',
					storage: 'AccountFile',
					downloadUrl: 'https://t/0/rest/FileService/Download/AccountFile/f1',
				},
				{
					id: 'l1',
					name: 'https://example.com',
					kind: 'link',
					size: 0,
					createdOn: '2026-01-01T10:00:00',
					storage: 'AccountFile',
					url: 'https://example.com',
				},
			],
			hasMore: false,
		});
		// Never the content column; the record filters per storage.
		for (const [query] of crud.read.mock.calls as any[]) {
			expect(query.columns).not.toContain('Data');
		}
		expect((crud.read.mock.calls[0] as any)[0].filter).toEqual({
			kind: 'condition',
			field: 'AccountId',
			op: 'eq',
			value: RECORD,
		});
	});

	it('reports hasMore and trims to top', async () => {
		const row = (i: number) => ({
			Id: `f${i}`,
			Name: `${i}`,
			TypeId: FILE_TYPE,
			Size: 1,
			CreatedOn: `2026-01-0${i}`,
		});
		const crud = crudWith({ AccountFile: [row(1), row(2)], SysFile: [row(3)] });
		const result = await service(crud).listRecordFiles({
			entity: 'Account',
			id: RECORD,
			top: 2,
		});
		expect(result.files.map((f) => f.id)).toEqual(['f3', 'f2']);
		expect(result.hasMore).toBe(true);
	});

	it('skips a missing <Entity>File table but propagates any other failure', async () => {
		const missing = crudWith({
			ContactTypeFile: new UnknownNameError('entity', 'ContactTypeFile', 'ContactTypeFile'),
			SysFile: [{ Id: 's1', Name: 'a', TypeId: FILE_TYPE, Size: 1, CreatedOn: null }],
		});
		const ok = await service(missing).listRecordFiles({
			entity: 'ContactType',
			id: RECORD,
			top: 5,
		});
		expect(ok.files.map((f) => f.id)).toEqual(['s1']);

		const broken = crudWith({ AccountFile: new Error('creatio_read_failed:500 boom') });
		await expect(
			service(broken).listRecordFiles({ entity: 'Account', id: RECORD, top: 5 }),
		).rejects.toThrow('boom');
	});

	it('validates the entity name and id before querying', async () => {
		const crud = crudWith({});
		await expect(
			service(crud).listRecordFiles({ entity: 'Account;x', id: RECORD, top: 5 }),
		).rejects.toThrow(/invalid_entity_name/);
		await expect(
			service(crud).listRecordFiles({ entity: 'Account', id: 'nope', top: 5 }),
		).rejects.toThrow(/invalid_record_id/);
		expect(crud.read).not.toHaveBeenCalled();
	});
});

describe('RecordFilesService over the real DataService provider (wire format)', () => {
	it('filters the classic table by its lookup and SysFile by the real RecordId column', async () => {
		const schemas: Record<string, unknown> = {
			AccountFile: { Account: DataValueType.Lookup, Type: DataValueType.Lookup },
			SysFile: {
				RecordId: DataValueType.Guid,
				RecordSchemaName: DataValueType.Text,
				Type: DataValueType.Lookup,
			},
		};
		const { client, calls } = makeHttpClientHarness((url, init) => {
			if (url.endsWith('/RuntimeEntitySchemaRequest')) {
				const name = JSON.parse(String(init.body)).name;
				const columns = Object.entries(schemas[name] as object).map(
					([n, dataValueType]) => [n, { name: n, dataValueType }],
				);
				return jsonResponse({
					success: true,
					schema: { name, columns: { Items: Object.fromEntries(columns) } },
				});
			}
			return jsonResponse({ success: true, rows: [] });
		});
		const crud = new DataServiceCrudProvider(client);
		await new RecordFilesService(crud, new NavigationServiceProvider(client)).listRecordFiles({
			entity: 'Account',
			id: RECORD,
			top: 5,
		});
		const selects = calls
			.filter((c) => c.url.endsWith('/SelectQuery'))
			.map((c) => bodyOf(c) as any);
		const paths = (q: any): string[] =>
			q.leftExpression
				? [q.leftExpression.columnPath]
				: Object.values(q.items ?? {}).flatMap(paths);
		const byEntity = Object.fromEntries(selects.map((s) => [s.rootSchemaName, s]));
		expect(paths(byEntity.AccountFile.filters)).toEqual(['Account.Id']);
		expect(paths(byEntity.SysFile.filters).sort()).toEqual(['RecordId', 'RecordSchemaName']);
		expect(byEntity.SysFile.columns.items.TypeId.expression.columnPath).toBe('Type.Id');
	});
});

describe('NavigationServiceProvider.fileDownloadUrl', () => {
	it('builds the FileService download link and validates its parts', () => {
		const { client } = makeHttpClientHarness(() => new Response(''));
		const nav = new NavigationServiceProvider(client);
		expect(nav.fileDownloadUrl('AccountFile', RECORD)).toBe(
			`https://tenant.creatio.local/0/rest/FileService/Download/AccountFile/${RECORD}`,
		);
		expect(() => nav.fileDownloadUrl('../x', RECORD)).toThrow(/invalid_entity_name/);
		expect(() => nav.fileDownloadUrl('AccountFile', 'x')).toThrow(/invalid_record_id/);
	});
});
