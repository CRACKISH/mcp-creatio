import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CreatioEngineManager,
	CrudEngine,
	DataServiceCrudProvider,
	UnknownNameError,
} from '../../src/creatio';
import { toUnknownNameError as dataServiceError } from '../../src/creatio/services/dataservice/data-service-errors';
import { toUnknownNameError as odataError } from '../../src/creatio/services/odata/odata-errors';
import { Server } from '../../src/server/mcp';
import { suggestNames } from '../../src/utils';
import { makeFakeContext } from '../support/fake-context';
import { jsonResponse, makeHttpClientHarness } from '../support/http-client';

afterEach(() => vi.unstubAllGlobals());

const CONTACT_COLUMNS = ['Id', 'Name', 'Email', 'EmailVerified', 'Account', 'AccountId', 'Phone'];

describe('suggestNames', () => {
	it('ranks a case-only difference first, then close typos', () => {
		expect(suggestNames('Emial', CONTACT_COLUMNS)).toEqual(['Email']);
		expect(suggestNames('email', CONTACT_COLUMNS)[0]).toBe('Email');
		expect(suggestNames('Acount', CONTACT_COLUMNS)).toEqual(['Account', 'AccountId']);
	});

	it('suggests nothing when no name is close, and respects the limit', () => {
		expect(suggestNames('Birthday', CONTACT_COLUMNS)).toEqual([]);
		expect(suggestNames('Ab', ['Aa', 'Ac', 'Ad', 'Ae'], 2)).toHaveLength(2);
	});
});

describe('dialect classifiers (messages verified live)', () => {
	const ds = (message: string) => dataServiceError(new Error(message), 'Contact');

	it('DataService: column by path, collection item, unknown entity', () => {
		expect(
			ds('500 {"Message":"Column by path Emial not found in schema Contact."}'),
		).toMatchObject({
			kind: 'column',
			unknownName: 'Emial',
		});
		expect(ds('500 {"Message":"Collection item with name Acount not found."}')).toMatchObject({
			kind: 'column',
			unknownName: 'Acount',
		});
		expect(ds('500 {"Message":"Item with name \\"Contakt\\" not found"}')).toMatchObject({
			kind: 'entity',
			unknownName: 'Contakt',
		});
		expect(ds('500 {"Message":"Something else"}')).toBeUndefined();
	});

	it('OData: unknown property; a 404 means an unknown entity only on a collection read', () => {
		const property = odataError(
			new Error(
				"creatio_read_failed:400 Could not find a property named 'Emial' on type 'X'",
			),
			'Contact',
			true,
		);
		expect(property).toMatchObject({ kind: 'column', unknownName: 'Emial' });
		const writeBody = odataError(
			new Error(
				"creatio_create_failed:400 item : The property 'Nmae' does not exist on type 'X'",
			),
			'ContactType',
			true,
		);
		expect(writeBody).toMatchObject({ kind: 'column', unknownName: 'Nmae' });
		const notFound = new Error('creatio_read_failed:404 ');
		expect(odataError(notFound, 'Contakt', true)).toMatchObject({
			kind: 'entity',
			unknownName: 'Contakt',
		});
		expect(
			odataError(new Error('creatio_update_failed:404 '), 'Contact', false),
		).toBeUndefined();
	});
});

function engineWith(fail: unknown, overrides: Record<string, unknown> = {}) {
	const provider = {
		kind: 'fake',
		capabilities: { rawFilter: false, expand: false },
		listEntitySets: vi.fn(async () => ['Contact', 'Account', 'Activity']),
		describeEntity: vi.fn(async () => ({
			entitySet: 'Contact',
			entityType: 'Contact',
			key: ['Id'],
			properties: CONTACT_COLUMNS.map((name) => ({ name, type: 'Text' })),
		})),
		read: vi.fn(async () => {
			throw fail;
		}),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		toUnknownNameError: (err: unknown, { entity }: { entity: string }) =>
			dataServiceError(err, entity),
		...overrides,
	};
	return { engine: new CrudEngine(provider as never), provider };
}

describe('CrudEngine — unknown names get suggestions', () => {
	const query = { entity: 'Contact', columns: ['Emial'] };

	it('adds the closest columns from the schema to the error', async () => {
		const { engine } = engineWith(
			new Error('Column by path Emial not found in schema Contact.'),
		);
		const err = await engine.read(query).catch((e) => e);
		expect(err).toBeInstanceOf(UnknownNameError);
		expect(err.message).toBe('unknown_column:Emial (Contact). Did you mean: Email?');
		expect(err.suggestions).toEqual(['Email']);
	});

	it('suggests entity names for an unknown entity', async () => {
		const { engine } = engineWith(new Error('Item with name \\"Contakt\\" not found'));
		const err = await engine.read({ entity: 'Contakt' }).catch((e) => e);
		expect(err.message).toBe('unknown_entity:Contakt. Did you mean: Contact?');
	});

	it('keeps the original error when suggestions cannot be computed, or for a dotted path', async () => {
		const { engine } = engineWith(
			new Error('Column by path Emial not found in schema Contact.'),
			{
				describeEntity: vi.fn(async () => {
					throw new Error('schema unavailable');
				}),
			},
		);
		expect((await engine.read(query).catch((e) => e)).message).toBe(
			'unknown_column:Emial (Contact)',
		);
		const dotted = engineWith(
			new Error('Column by path Account.Nmae not found in schema Contact.'),
		);
		expect((await dotted.engine.read(query).catch((e) => e)).message).toBe(
			'unknown_column:Account.Nmae (Contact)',
		);
		expect(dotted.provider.describeEntity).not.toHaveBeenCalled();
	});

	it('passes any other failure through untouched', async () => {
		const original = new Error('creatio_read_failed:500 boom');
		const { engine } = engineWith(original);
		expect(await engine.read(query).catch((e) => e)).toBe(original);
	});
});

describe('DataService provider — an unknown selected column is an error, not a silent drop', () => {
	it('throws UnknownNameError for notFoundColumns', async () => {
		const { client } = makeHttpClientHarness(() =>
			jsonResponse({ success: true, notFoundColumns: ['Emial'], rows: [{ Id: '1' }] }),
		);
		await expect(
			new DataServiceCrudProvider(client).read({
				entity: 'Contact',
				columns: ['Id', 'Emial'],
			}),
		).rejects.toMatchObject({ kind: 'column', unknownName: 'Emial', entity: 'Contact' });
	});
});

describe('read tool surfaces the suggestion to the agent', () => {
	it('rejects with the enriched message', async () => {
		const context = makeFakeContext();
		context.crud.read = vi.fn(async () => {
			throw new UnknownNameError('column', 'Emial', 'Contact');
		}) as never;
		(context.crud as any).describeEntity = vi.fn(async () => ({
			entitySet: 'Contact',
			entityType: 'Contact',
			key: ['Id'],
			properties: [{ name: 'Email', type: 'Text' }],
		}));
		const server = new Server(new CreatioEngineManager(context as never), {});
		const handler = (server as any)._handlers.get('read');
		await expect(handler({ entity: 'Contact', select: ['Emial'] })).rejects.toThrow(
			'unknown_column:Emial (Contact). Did you mean: Email?',
		);
	});
});

describe('self-review regressions', () => {
	// OData says "The property 'X' cannot be used in …" about properties that DO exist; that must
	// stay the original Creatio error, not a false unknown_column.
	it('only treats the unknown-property phrasings as unknown columns', () => {
		const existing = new Error(
			"creatio_read_failed:400 The property 'Name' cannot be used in the $orderby query option.",
		);
		expect(odataError(existing, 'Contact', true)).toBeUndefined();
	});

	// A huge client-supplied name must not turn the O(n·m) distance into an event-loop stall.
	it('skips suggestions for an absurdly long name and stays fast', () => {
		const started = Date.now();
		expect(
			suggestNames(
				'x'.repeat(100_000),
				Array.from({ length: 2000 }, (_, i) => `Column${i}`),
			),
		).toEqual([]);
		expect(Date.now() - started).toBeLessThan(500);
	});
});
