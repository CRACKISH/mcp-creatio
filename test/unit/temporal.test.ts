import { describe, expect, it } from 'vitest';

import {
	UTC_ZONE,
	UserClock,
	describeUserZone,
	fixedOffsetZone,
	formatOffset,
	hasTemporalFilterValue,
	ianaZone,
	mapTemporalFilterValues,
	resolveUserZone,
	temporalColumns,
	temporalKindOf,
	toIanaZone,
	wallClockToUtc,
} from '../../src/creatio/temporal';
import creatioZoneCodes from '../fixtures/creatio-time-zone-codes.json';

const ms = (iso: string) => Date.parse(iso);
const wall = (digits: string) => Date.parse(`${digits}Z`); // the digits as UTC-epoch ms

// Supervisor's profile zone on the regression stands: UTC+0 in July, UTC-1 in November.
const azores = new UserClock(ianaZone('Atlantic/Azores'));
const kyiv = new UserClock(ianaZone('Europe/Kyiv'));
const anchorage = new UserClock(ianaZone('America/Anchorage'));

describe('zone rules', () => {
	it('applies daylight saving per instant', () => {
		const zone = ianaZone('Europe/Kyiv');
		expect(zone.offsetMinutesAt(ms('2026-07-10T12:00:00Z'))).toBe(180);
		expect(zone.offsetMinutesAt(ms('2026-11-10T12:00:00Z'))).toBe(120);
		expect(ianaZone('America/Anchorage').offsetMinutesAt(ms('2026-11-10T12:00:00Z'))).toBe(
			-540,
		);
	});

	it('formats offsets and fixed zones', () => {
		expect(formatOffset(0)).toBe('+00:00');
		expect(formatOffset(-570)).toBe('-09:30');
		expect(formatOffset(345)).toBe('+05:45');
		expect(fixedOffsetZone(-540).name).toBe('UTC-09:00');
		expect(UTC_ZONE.offsetMinutesAt(0)).toBe(0);
	});

	// Creatio converts with .NET TimeZoneInfo.ConvertTimeToUtc after moving an invalid time an hour
	// forward (DateTimeDataValueType.GetValueForSave): the conversion must store the same instant.
	it('resolves a repeated fall-back wall clock to its later (standard-time) occurrence', () => {
		expect(wallClockToUtc(wall('2026-10-25T03:30:00'), ianaZone('Europe/Kyiv'))).toBe(
			ms('2026-10-25T01:30:00Z'),
		);
	});

	it('moves a wall clock skipped by spring-forward one hour forward, as Creatio does', () => {
		expect(wallClockToUtc(wall('2026-03-29T03:30:00'), ianaZone('Europe/Kyiv'))).toBe(
			ms('2026-03-29T01:30:00Z'),
		);
	});
});

describe('Windows zone ids', () => {
	it('maps Windows ids, keeps IANA names, and knows the retired ids Creatio still ships', () => {
		expect(toIanaZone('FLE Standard Time')).toBe('Europe/Kiev');
		expect(toIanaZone('Alaskan Standard Time')).toBe('America/Anchorage');
		expect(toIanaZone('Europe/Kyiv')).toBe('Europe/Kyiv');
		expect(toIanaZone('Kamchatka Standard Time')).toBe('Asia/Kamchatka');
		expect(toIanaZone('Mid-Atlantic Standard Time')).toBe('Etc/GMT+2');
		expect(toIanaZone('Nowhere Standard Time')).toBeUndefined();
		expect(toIanaZone(undefined)).toBeUndefined();
	});

	it('maps every zone of Creatio’s TimeZone lookup (10.2, both runtimes) to a usable zone', () => {
		const unmapped = (creatioZoneCodes as string[]).filter((code) => !toIanaZone(code));
		expect(unmapped).toEqual([]);
	});
});

describe('UserClock — tool input', () => {
	it('DataService: a zone-less DateTime is the user wall clock, a zoned one an exact instant', () => {
		expect(azores.toWallClock('datetime', '2026-11-10T15:00')).toBe('2026-11-10T15:00:00');
		// 15:00Z in November is 14:00 in the Azores (UTC-1).
		expect(azores.toWallClock('datetime', '2026-11-10T15:00:00Z')).toBe('2026-11-10T14:00:00');
		expect(azores.toWallClock('datetime', '2026-11-10T15:00:00+03:00')).toBe(
			'2026-11-10T11:00:00',
		);
		expect(kyiv.toWallClock('datetime', new Date('2026-07-10T12:00:00Z'))).toBe(
			'2026-07-10T15:00:00',
		);
		expect(azores.toWallClock('datetime', '2026-11-10')).toBe('2026-11-10T00:00:00');
		expect(azores.toWallClock('datetime', '2026-11-10T15:00:00.25Z')).toBe(
			'2026-11-10T14:00:00.250',
		);
	});

	it('DataService: a Date keeps its calendar date, a Time its clock', () => {
		expect(anchorage.toWallClock('date', '1990-12-07T00:00:00Z')).toBe('1990-12-07T00:00:00');
		expect(anchorage.toWallClock('date', '1990-12-07')).toBe('1990-12-07T00:00:00');
		expect(anchorage.toWallClock('time', '09:30')).toBe('1970-01-01T09:30:00');
		expect(anchorage.toWallClock('time', '2026-11-10T09:30:15')).toBe('1970-01-01T09:30:15');
	});

	it('OData: every DateTime becomes a UTC instant, a Date stays the date written', () => {
		expect(azores.toInstant('datetime', '2026-11-10T15:00:00')).toBe('2026-11-10T16:00:00Z');
		expect(azores.toInstant('datetime', '2026-07-10T15:00:00')).toBe('2026-07-10T15:00:00Z');
		expect(azores.toInstant('datetime', '2026-11-10T15:00:00+02:00')).toBe(
			'2026-11-10T13:00:00Z',
		);
		expect(anchorage.toInstant('date', '1990-12-07T22:00:00-09:00')).toBe(
			'1990-12-07T00:00:00Z',
		);
		expect(anchorage.toInstant('time', '09:30')).toBe('09:30');
	});

	it('leaves anything that is not a date/time literal for Creatio to judge', () => {
		for (const value of ['soon', '2026-02-30T10:00:00', '25:00', 42, null, undefined]) {
			expect(azores.toWallClock('datetime', value)).toBe(value);
			expect(azores.toInstant('datetime', value)).toBe(value);
		}
		expect(azores.toWallClock('time', '25:00')).toBe('25:00');
	});
});

describe('UserClock — tool output', () => {
	it('DataService: labels Creatio’s wall clock with the user offset of that date', () => {
		expect(azores.fromWallClock('datetime', '2026-11-10T15:00:00.000')).toBe(
			'2026-11-10T15:00:00-01:00',
		);
		expect(azores.fromWallClock('datetime', '2026-07-10T15:00:00.000')).toBe(
			'2026-07-10T15:00:00+00:00',
		);
		expect(kyiv.fromWallClock('datetime', '2026-07-10T15:00:00.120')).toBe(
			'2026-07-10T15:00:00.120+03:00',
		);
		expect(azores.fromWallClock('date', '1986-01-20T00:00:00.000')).toBe('1986-01-20');
		expect(azores.fromWallClock('time', '1970-01-01T09:30:00.000')).toBe('09:30:00');
		expect(azores.fromWallClock('datetime', 'not a date')).toBe('not a date');
	});

	it('OData: shows a UTC instant as the user wall clock; a Date column keeps its date', () => {
		// Live: a DataService write of 15:00 (Azores, November) reads back from OData as 16:00Z.
		expect(azores.fromInstant('datetime', '2026-11-10T16:00:00Z')).toBe(
			'2026-11-10T15:00:00-01:00',
		);
		expect(anchorage.fromInstant('date', '1986-01-20T00:00:00Z')).toBe('1986-01-20');
		expect(anchorage.fromInstant('datetime', '2026-11-10T16:00:00')).toBe(
			'2026-11-10T16:00:00',
		);
		expect(anchorage.fromInstant('time', 'whatever')).toBe('whatever');
	});

	it('round-trips any instant through both dialects (outside a repeated hour)', () => {
		for (
			let t = ms('2026-01-01T00:17:00Z');
			t < ms('2027-01-01T00:00:00Z');
			t += 37 * 3600_000
		) {
			const instant = new Date(t).toISOString();
			for (const clock of [azores, kyiv, anchorage]) {
				const viaDataService = clock.fromWallClock(
					'datetime',
					clock.toWallClock('datetime', instant),
				) as string;
				const viaOData = clock.fromInstant(
					'datetime',
					clock.toInstant('datetime', instant),
				) as string;
				expect(Date.parse(viaDataService)).toBe(t);
				expect(viaOData).toBe(viaDataService);
			}
		}
	});
});

describe('column kinds and filters', () => {
	it('knows the three temporal DataValueTypes', () => {
		expect([7, 8, 9, 1, undefined].map(temporalKindOf)).toEqual([
			'datetime',
			'date',
			'time',
			undefined,
			undefined,
		]);
		expect([
			...temporalColumns(
				new Map([
					['A', 7],
					['B', 1],
					['C', 8],
				]),
			),
		]).toEqual([
			['A', 'datetime'],
			['C', 'date'],
		]);
	});

	it('converts filter values by their column kind; a related path only when zoned', () => {
		const node = {
			kind: 'group' as const,
			logic: 'and' as const,
			items: [
				{
					kind: 'condition' as const,
					field: 'StartDate',
					op: 'ge' as const,
					value: '2026-11-10',
				},
				{ kind: 'condition' as const, field: 'Title', op: 'eq' as const, value: 'x' },
				{
					kind: 'condition' as const,
					field: 'Owner.CreatedOn',
					op: 'lt' as const,
					value: '2026-11-10T00:00:00Z',
				},
				{
					kind: 'condition' as const,
					field: 'Owner.BirthDate',
					op: 'eq' as const,
					value: '1990-01-01',
				},
				{ kind: 'in' as const, field: 'StartDate', values: ['2026-11-10T15:00:00Z'] },
				{ kind: 'condition' as const, field: 'StartDate', op: 'isNull' as const },
			],
		};
		expect(hasTemporalFilterValue(node)).toBe(true);
		expect(hasTemporalFilterValue(node.items[1])).toBe(false);
		expect(hasTemporalFilterValue(undefined)).toBe(false);
		const mapped = mapTemporalFilterValues(
			node,
			new Map([['StartDate', 'datetime' as const]]),
			(kind, v) => azores.toWallClock(kind, v),
		);
		expect(mapped).toEqual({
			...node,
			items: [
				{ ...node.items[0], value: '2026-11-10T00:00:00' },
				node.items[1],
				{ ...node.items[2], value: '2026-11-09T23:00:00' },
				node.items[3],
				{ ...node.items[4], values: ['2026-11-10T14:00:00'] },
				node.items[5],
			],
		});
	});
});

describe('the user zone from GetCurrentUserInfo', () => {
	const now = ms('2026-10-20T12:00:00Z');

	it('maps the Windows id when it agrees with Creatio’s own current offset', () => {
		const zone = resolveUserZone(
			{ userInfo: { timeZoneId: 'Azores Standard Time', timeZoneOffsetHours: 0 } },
			now,
		);
		expect(zone).toMatchObject({ source: 'zone', timeZone: 'Atlantic/Azores' });
		expect(zone.rules.offsetMinutesAt(ms('2026-11-10T12:00:00Z'))).toBe(-60);
	});

	it('falls back to Creatio’s offset when the zone is unknown or disagrees, else UTC', () => {
		const unknown = resolveUserZone(
			{ timeZoneId: 'Mars Standard Time', timeZoneOffsetHours: 5.5 },
			now,
		);
		expect(unknown).toMatchObject({ source: 'offset' });
		expect(unknown.rules.offsetMinutesAt(now)).toBe(330);
		const disagrees = resolveUserZone(
			{ timeZoneId: 'FLE Standard Time', timeZoneOffsetHours: -9 },
			now,
		);
		expect(disagrees).toMatchObject({ source: 'offset' });
		expect(disagrees.rules.offsetMinutesAt(now)).toBe(-540);
		expect(resolveUserZone({}, now)).toMatchObject({ source: 'utc' });
	});

	it('describes the zone for get-current-user-info', () => {
		expect(
			describeUserZone(
				{ userInfo: { timeZoneId: 'FLE Standard Time', timeZoneOffsetHours: 3 } },
				now,
			),
		).toEqual({
			timeZone: 'Europe/Kiev',
			utcOffset: '+03:00',
			now: '2026-10-20T15:00:00+03:00',
			today: '2026-10-20',
		});
		expect(describeUserZone({ userInfo: {} }, now)).toEqual({
			utcOffset: '+00:00',
			now: '2026-10-20T12:00:00+00:00',
			today: '2026-10-20',
		});
	});

	// "Today" is the user's date, not the server's: 23:30 UTC is already tomorrow in Kyiv.
	it("gives the user's own date near midnight, without fractions of a second", () => {
		const late = Date.parse('2026-10-20T23:30:00.789Z');
		expect(
			describeUserZone(
				{ userInfo: { timeZoneId: 'FLE Standard Time', timeZoneOffsetHours: 3 } },
				late,
			),
		).toMatchObject({ now: '2026-10-21T02:30:00+03:00', today: '2026-10-21' });
		expect(
			describeUserZone(
				{ userInfo: { timeZoneId: 'Alaskan Standard Time', timeZoneOffsetHours: -8 } },
				late,
			),
		).toMatchObject({ now: '2026-10-20T15:30:00-08:00', today: '2026-10-20' });
	});
});
