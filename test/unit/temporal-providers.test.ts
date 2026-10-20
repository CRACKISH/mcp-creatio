import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatioEngineManager } from '../../src/creatio';
import { createCrudProvider } from '../../src/creatio/services/crud-provider-factory';
import { DataServiceCrudProvider } from '../../src/creatio/services/dataservice/data-service-crud-provider';
import { ODataCrudProvider } from '../../src/creatio/services/odata/odata-crud-provider';
import { UserTimeZoneResolver, fixedClockSource } from '../../src/creatio/services/user-time-zone';
import { ianaZone } from '../../src/creatio/temporal';
import { Server } from '../../src/server/mcp';
import { runWithContext } from '../../src/utils/context';
import { makeFakeContext } from '../support/fake-context';
import { bodyOf, jsonResponse, makeHttpClientHarness } from '../support/http-client';

afterEach(() => vi.unstubAllGlobals());

// Supervisor's profile zone on the regression stands: UTC+0 in July, UTC-1 in November.
const AZORES = () => fixedClockSource(ianaZone('Atlantic/Azores'));

const ACTIVITY_SCHEMA = {
	success: true,
	schema: {
		name: 'Activity',
		columns: {
			Items: {
				a: { name: 'Id', dataValueType: 0 },
				b: { name: 'Title', dataValueType: 1 },
				c: { name: 'StartDate', dataValueType: 7 },
				d: { name: 'Owner', dataValueType: 10, referenceSchemaName: 'Contact' },
			},
		},
	},
};

const parameterValue = (body: any, column: string) =>
	body.columnValues.items[column].parameter.value;

/** DataService responder: schema for `RuntimeEntitySchemaRequest`, `select` for SelectQuery. */
function dataService(select: unknown = { success: true, rows: [] }) {
	return makeHttpClientHarness((url) => {
		if (url.endsWith('/RuntimeEntitySchemaRequest')) {
			return jsonResponse(ACTIVITY_SCHEMA);
		}
		if (url.endsWith('/SelectQuery')) {
			return jsonResponse(select);
		}
		return jsonResponse({ success: true, id: 'new-id', rowsAffected: 1 });
	});
}

describe('DataService — dates in the user profile zone', () => {
	// Regression: a UTC input used to have its `Z` stripped, storing 15:00Z as 15:00 local — an
	// hour off in the Azores in November, three in Kyiv in summer.
	it('writes a zoned DateTime as the user wall clock, a zone-less one as written', async () => {
		const { client, calls } = dataService();
		const provider = new DataServiceCrudProvider(client, { clock: AZORES() });
		await provider.create({
			entity: 'Activity',
			data: { Title: '2026-11-10T15:00:00Z', StartDate: '2026-11-10T15:00:00Z' },
		});
		await provider.update({
			entity: 'Activity',
			id: '11111111-1111-1111-1111-111111111111',
			data: { StartDate: '2026-11-10T15:00:00' },
		});
		const [insert, update] = calls.filter((c) => /(Insert|Update)Query$/.test(c.url));
		expect(parameterValue(bodyOf(insert!), 'StartDate')).toBe('"2026-11-10T14:00:00"');
		expect(parameterValue(bodyOf(insert!), 'Title')).toBe('2026-11-10T15:00:00Z');
		expect(parameterValue(bodyOf(update!), 'StartDate')).toBe('"2026-11-10T15:00:00"');
	});

	it('reads DateTime cells labelled with the user offset, and converts filter values', async () => {
		const { client, calls } = dataService({
			success: true,
			rows: [{ StartDate: '2026-11-10T15:00:00.000', Title: 'Call', Count: 3 }],
			rowConfig: {
				StartDate: { dataValueType: 7 },
				Title: { dataValueType: 1 },
				Count: { dataValueType: 4 },
			},
		});
		const provider = new DataServiceCrudProvider(client, { clock: AZORES() });
		const result = await provider.read({
			entity: 'Activity',
			columns: ['StartDate', 'Title'],
			filter: {
				kind: 'condition',
				field: 'StartDate',
				op: 'ge',
				value: '2026-11-10T15:00:00Z',
			},
			count: true,
		});
		expect(result.items).toEqual([{ StartDate: '2026-11-10T15:00:00-01:00', Title: 'Call' }]);
		const selects = calls.filter((c) => c.url.endsWith('/SelectQuery'));
		expect(selects).toHaveLength(2); // rows + count: both carry the converted value
		for (const call of selects) {
			expect(JSON.stringify(bodyOf(call))).toContain('\\"2026-11-10T14:00:00\\"');
		}
	});

	it('asks for the zone only when a date is written, filtered or returned', async () => {
		const clock = { current: vi.fn(AZORES().current) };
		const { client } = dataService({
			success: true,
			rows: [{ Title: 'x' }],
			rowConfig: { Title: { dataValueType: 1 } },
		});
		const provider = new DataServiceCrudProvider(client, { clock });
		await provider.read({ entity: 'Activity', columns: ['Title'] });
		await provider.create({ entity: 'Activity', data: { Title: 'x' } });
		expect(clock.current).not.toHaveBeenCalled();
	});

	it('fails the read when the user zone cannot be resolved (never guesses)', async () => {
		const { client } = dataService({
			success: true,
			rows: [{ StartDate: '2026-11-10T15:00:00.000' }],
			rowConfig: { StartDate: { dataValueType: 7 } },
		});
		const provider = new DataServiceCrudProvider(client, {
			clock: {
				current: () =>
					Promise.reject(new Error('creatio_get_current_user_info_failed:401')),
			},
		});
		await expect(provider.read({ entity: 'Activity', columns: ['StartDate'] })).rejects.toThrow(
			'creatio_get_current_user_info_failed:401',
		);
	});
});

const CONTACT_TYPES = new Map([
	['BirthDate', 8],
	['CreatedOn', 7],
]);

function odataSchema() {
	return {
		columnTypes: vi.fn(async (entity: string) =>
			entity === 'Activity'
				? new Map([
						['StartDate', 7],
						['Title', 1],
					])
				: CONTACT_TYPES,
		),
		references: vi.fn(async (entity: string) =>
			entity === 'Activity' ? new Map([['Owner', 'Contact']]) : new Map(),
		),
	};
}

describe('OData — UTC on the wire, the user zone at the tools', () => {
	it('writes a zone-less DateTime as the user wall clock in UTC and labels the created record', async () => {
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({ Id: 'x', StartDate: '2026-11-10T16:00:00Z', Title: 'Call' }),
		);
		const provider = new ODataCrudProvider(client, {} as never, undefined, {
			schema: odataSchema(),
			clock: AZORES(),
		});
		const created = await provider.create({
			entity: 'Activity',
			data: { Title: 'Call', StartDate: '2026-11-10T15:00:00' },
		});
		expect(bodyOf(calls[0]!)).toEqual({ Title: 'Call', StartDate: '2026-11-10T16:00:00Z' });
		expect(created).toEqual({ Id: 'x', StartDate: '2026-11-10T15:00:00-01:00', Title: 'Call' });
		await provider.update({
			entity: 'Activity',
			id: '11111111-1111-1111-1111-111111111111',
			data: { StartDate: '2026-07-10T15:00:00+02:00' },
		});
		expect(bodyOf(calls[1]!)).toEqual({ StartDate: '2026-07-10T13:00:00Z' });
	});

	it('labels read values, into an expanded lookup, keeping a Date column’s calendar date', async () => {
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({
				value: [
					{
						StartDate: '2026-11-10T16:00:00Z',
						Owner: {
							BirthDate: '1986-01-20T00:00:00Z',
							CreatedOn: '2026-07-10T15:00:00Z',
						},
						Participants: [{ CreatedOn: '2026-07-10T15:00:00Z' }],
					},
				],
			}),
		);
		const schema = odataSchema();
		const provider = new ODataCrudProvider(client, {} as never, undefined, {
			schema,
			clock: AZORES(),
		});
		const result = await provider.read({
			entity: 'Activity',
			filter: {
				kind: 'condition',
				field: 'StartDate',
				op: 'ge',
				value: '2026-11-10T15:00:00',
			},
			odata: { expand: ['Owner'] },
		});
		expect(result.items).toEqual([
			{
				StartDate: '2026-11-10T15:00:00-01:00',
				Owner: { BirthDate: '1986-01-20', CreatedOn: '2026-07-10T15:00:00+00:00' },
				// Not a lookup of Activity: left as Creatio sent it (still an exact UTC instant).
				Participants: [{ CreatedOn: '2026-07-10T15:00:00Z' }],
			},
		]);
		expect(decodeURIComponent(calls[0]!.url)).toContain('StartDate ge 2026-11-10T16:00:00Z');
		expect(schema.columnTypes).toHaveBeenCalledTimes(3); // filter + Activity + Contact, each once
	});

	it('without a schema (or a date) leaves values and the zone alone', async () => {
		const clock = { current: vi.fn(AZORES().current) };
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({ value: [{ StartDate: '2026-11-10T16:00:00Z' }] }),
		);
		const provider = new ODataCrudProvider(client, {} as never, undefined, {
			schema: { columnTypes: async () => new Map(), references: async () => new Map() },
			clock,
		});
		const result = await provider.read({ entity: 'Activity', columns: ['StartDate'] });
		expect(result.items).toEqual([{ StartDate: '2026-11-10T16:00:00Z' }]);
		await provider.create({ entity: 'Activity', data: { StartDate: '2026-11-10T15:00:00' } });
		expect(bodyOf(calls[1]!)).toEqual({ StartDate: '2026-11-10T15:00:00' });
		expect(clock.current).not.toHaveBeenCalled();
	});

	it('the factory gives OData Creatio’s schema (DataService serves it on both runtimes)', async () => {
		const { client, calls } = makeHttpClientHarness((url) =>
			url.endsWith('/RuntimeEntitySchemaRequest')
				? jsonResponse(ACTIVITY_SCHEMA)
				: jsonResponse({ value: [] }),
		);
		const provider = createCrudProvider('odata', {
			client,
			metadataStore: {} as never,
			clock: AZORES(),
		});
		await provider.read({
			entity: 'Activity',
			filter: { kind: 'condition', field: 'StartDate', op: 'lt', value: '2026-11-10' },
		});
		expect(calls[0]!.url).toContain('/0/DataService/json/SyncReply/RuntimeEntitySchemaRequest');
		expect(decodeURIComponent(calls[1]!.url)).toContain('StartDate lt 2026-11-10T01:00:00Z');
	});
});

describe('UserTimeZoneResolver', () => {
	const userInfo = { userInfo: { timeZoneId: 'Azores Standard Time', timeZoneOffsetHours: 0 } };

	it('asks Creatio once per caller and serves the profile zone', async () => {
		const user = { kind: 'u', getCurrentUserInfo: vi.fn(async () => userInfo) };
		const resolver = new UserTimeZoneResolver(user, () => 'https://a');
		const [a, b] = await Promise.all([resolver.current(), resolver.current()]);
		expect(a).toBe(b);
		expect(a.zone.name).toBe('Atlantic/Azores');
		expect(user.getCurrentUserInfo).toHaveBeenCalledTimes(1);
	});

	// The passthrough modes' userKey is unverified: the zone must follow the credential itself.
	it('keys passthrough callers by their credential, and tenants by base URL', async () => {
		const user = { kind: 'u', getCurrentUserInfo: vi.fn(async () => userInfo) };
		let base = 'https://a';
		const resolver = new UserTimeZoneResolver(user, () => base);
		const as = (token: string) =>
			runWithContext({ userKey: 'same', credential: { kind: 'bearer', token } }, () =>
				resolver.current(),
			);
		await as('t1');
		await as('t1');
		await as('t2');
		base = 'https://b';
		await as('t2');
		expect(user.getCurrentUserInfo).toHaveBeenCalledTimes(3);
	});

	it('rethrows a failed lookup without caching it', async () => {
		const user = {
			kind: 'u',
			getCurrentUserInfo: vi
				.fn()
				.mockRejectedValueOnce(new Error('creatio_get_current_user_info_failed:503'))
				.mockResolvedValue({ userInfo: { timeZoneOffsetHours: 5.5 } }),
		};
		const resolver = new UserTimeZoneResolver(user, () => 'https://a');
		await expect(resolver.current()).rejects.toThrow('503');
		expect((await resolver.current()).zone.name).toBe('UTC+05:30');
	});
});

describe('get-current-user-info', () => {
	it('adds the IANA zone and today’s offset the record tools use', async () => {
		const context = makeFakeContext();
		context.user.getCurrentUserInfo = vi.fn().mockResolvedValue({
			success: true,
			userInfo: {
				contactId: 'c-1',
				timeZoneId: 'Alaskan Standard Time',
				timeZoneOffsetHours: -8,
			},
		}) as never;
		vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00Z'), toFake: ['Date'] });
		try {
			const server = new Server(new CreatioEngineManager(context as never), {});
			const res = await (server as any)._handlers.get('get-current-user-info')({});
			expect(res.userInfo).toMatchObject({
				contactId: 'c-1',
				timeZone: 'America/Anchorage',
				utcOffset: '-08:00',
			});
		} finally {
			vi.useRealTimers();
		}
	});
});
