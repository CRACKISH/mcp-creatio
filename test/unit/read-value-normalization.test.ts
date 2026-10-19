import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	DataServiceCrudProvider,
	DataValueType,
	EMPTY_GUID,
	ODataCrudProvider,
	isEmptyPlaceholder,
} from '../../src/creatio';
import { normalizeDataServiceRows } from '../../src/creatio/services/dataservice/data-service-row-normalizer';
import { normalizeODataValue } from '../../src/creatio/services/odata/odata-value-normalizer';
import { jsonResponse, makeHttpClientHarness } from '../support/http-client';

const ID = '11111111-1111-1111-1111-111111111111';
const MEDIUM_TEXT = 28; // an extended text type: still a text column

describe('isEmptyPlaceholder', () => {
	it.each([
		EMPTY_GUID,
		'0001-01-01',
		'0001-01-01T00:00:00Z',
		'0001-01-01T00:00:00.000Z',
		'0001-01-01T00:00:00+00:00',
	])('treats %j as "no value"', (value) => expect(isEmptyPlaceholder(value)).toBe(true));

	it.each(['', ID, '2001-01-01', '0001-01-02', 0, null, undefined])('keeps %j', (value) =>
		expect(isEmptyPlaceholder(value)).toBe(false),
	);
});

describe('normalizeDataServiceRows (typed by rowConfig)', () => {
	const rowConfig = {
		Name: { dataValueType: DataValueType.Text },
		Notes: { dataValueType: MEDIUM_TEXT },
		Account: { dataValueType: DataValueType.Lookup },
		Owner: { dataValueType: DataValueType.Lookup },
		Type: { dataValueType: DataValueType.Lookup },
		BirthDate: { dataValueType: DataValueType.Date },
		CreatedOn: { dataValueType: DataValueType.DateTime },
		Amount: { dataValueType: DataValueType.Money },
		AccountId: { dataValueType: DataValueType.Guid },
	};

	it('maps empty non-text cells to null and keeps a genuinely empty text', () => {
		const [row] = normalizeDataServiceRows(
			[
				{
					Name: '',
					Notes: '',
					Account: '',
					BirthDate: '',
					CreatedOn: '2026-01-02T03:04:05.000',
					Amount: '',
					AccountId: EMPTY_GUID,
				},
			],
			rowConfig,
		);
		expect(row).toEqual({
			Name: '',
			Notes: '',
			Account: null,
			BirthDate: null,
			CreatedOn: '2026-01-02T03:04:05.000',
			Amount: null,
			AccountId: null,
		});
	});

	it('compacts a lookup to { value, displayValue } and nulls an unset one', () => {
		const [row] = normalizeDataServiceRows(
			[
				{
					Owner: {
						value: ID,
						displayValue: 'Supervisor',
						primaryImageValue: '',
						primaryColorValue: '#fff',
					},
					Type: { value: EMPTY_GUID, displayValue: '' },
				},
			],
			rowConfig,
		);
		expect(row).toEqual({ Owner: { value: ID, displayValue: 'Supervisor' }, Type: null });
	});

	it('passes through columns the rowConfig does not type, and tolerates a missing rowConfig', () => {
		const rows = [{ Unknown: '', Other: EMPTY_GUID }];
		expect(normalizeDataServiceRows(rows, {})).toEqual(rows);
		expect(normalizeDataServiceRows(rows)).toEqual(rows);
	});
});

describe('normalizeODataValue', () => {
	it('nulls placeholders, recursing into $expand-ed objects and collections', () => {
		expect(
			normalizeODataValue({
				Id: ID,
				Name: '',
				AccountId: EMPTY_GUID,
				BirthDate: '0001-01-01T00:00:00Z',
				Account: { Id: ID, OwnerId: EMPTY_GUID },
				Activities: [{ StartDate: '0001-01-01T00:00:00Z', Title: 'Call' }],
				Count: 0,
				IsActive: false,
			}),
		).toEqual({
			Id: ID,
			Name: '',
			AccountId: null,
			BirthDate: null,
			Account: { Id: ID, OwnerId: null },
			Activities: [{ StartDate: null, Title: 'Call' }],
			Count: 0,
			IsActive: false,
		});
	});
});

describe('read() returns normalized values on both backends', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('DataService: types cells by the response rowConfig', async () => {
		const { client } = makeHttpClientHarness(() =>
			jsonResponse({
				success: true,
				rowConfig: {
					Name: { dataValueType: DataValueType.Text },
					Account: { dataValueType: DataValueType.Lookup },
					BirthDate: { dataValueType: DataValueType.Date },
				},
				rows: [
					{
						Name: '',
						Account: { value: ID, displayValue: 'Acme', primaryImageValue: '' },
						BirthDate: '',
					},
				],
			}),
		);
		const { items } = await new DataServiceCrudProvider(client).read({
			entity: 'Contact',
			columns: ['Name', 'Account', 'BirthDate'],
		});
		expect(items).toEqual([
			{ Name: '', Account: { value: ID, displayValue: 'Acme' }, BirthDate: null },
		]);
	});

	it('OData: nulls the empty-GUID / min-date placeholders', async () => {
		const { client } = makeHttpClientHarness(() =>
			jsonResponse({
				value: [{ Id: ID, AccountId: EMPTY_GUID, BirthDate: '0001-01-01T00:00:00Z' }],
			}),
		);
		const { items } = await new ODataCrudProvider(client, {} as never).read({
			entity: 'Contact',
		});
		expect(items).toEqual([{ Id: ID, AccountId: null, BirthDate: null }]);
	});
});
