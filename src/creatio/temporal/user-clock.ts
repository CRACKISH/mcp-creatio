import { ZoneRules, formatOffset, utcToWallClock, wallClockToUtc } from './zone-rules';

/** The three Creatio date/time column kinds. */
export type TemporalKind = 'datetime' | 'date' | 'time';

const DATE_TIME_TYPE = 7;
const DATE_TYPE = 8;
const TIME_TYPE = 9;

/** The temporal kind of a Creatio `DataValueType` code, or `undefined` for any other type. */
export function temporalKindOf(dataValueType: number | undefined): TemporalKind | undefined {
	switch (dataValueType) {
		case DATE_TIME_TYPE:
			return 'datetime';
		case DATE_TYPE:
			return 'date';
		case TIME_TYPE:
			return 'time';
		default:
			return undefined;
	}
}

/** The temporal columns of a column → `DataValueType` map, by kind. */
export function temporalColumns(
	types: ReadonlyMap<string, number>,
): ReadonlyMap<string, TemporalKind> {
	const kinds = new Map<string, TemporalKind>();
	for (const [name, type] of types) {
		const kind = temporalKindOf(type);
		if (kind) {
			kinds.set(name, kind);
		}
	}
	return kinds;
}

const MINUTE_MS = 60_000;
// Creatio's epoch day for a Time value (it stores only the time of day).
const TIME_EPOCH_DATE = '1970-01-01';

const DATE_TIME_RE =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
const CLOCK_RE = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,7})?)?$/;

interface DateTimeLiteral {
	/** `YYYY-MM-DD` as written. */
	readonly date: string;
	/** `HH:mm:ss[.fff]` as written (completed to seconds), when the literal has a time. */
	readonly clock?: string;
	/** The digits as UTC-epoch milliseconds (date at midnight when there is no time). */
	readonly digitsMs: number;
	/** The offset the literal states (`Z` = 0), or `undefined` for a zone-less literal. */
	readonly offsetMinutes?: number;
}

function fraction(raw: string | undefined): string {
	const ms = raw ? raw.slice(1, 4).padEnd(3, '0') : '000';
	return ms === '000' ? '' : `.${ms}`;
}

function parseOffset(zone: string): number {
	if (zone.toUpperCase() === 'Z') {
		return 0;
	}
	const sign = zone.startsWith('-') ? -1 : 1;
	const digits = zone.slice(1).replace(':', '');
	return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
}

/** An ISO-8601 date / date-time literal, or `undefined` for anything else (incl. impossible dates). */
function parseDateTime(value: unknown): DateTimeLiteral | undefined {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : parseDateTime(value.toISOString());
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const m = DATE_TIME_RE.exec(value.trim());
	if (!m) {
		return undefined;
	}
	const [, y, mo, d, h, mi, s, frac, zone] = m;
	const digitsMs = Date.UTC(
		Number(y),
		Number(mo) - 1,
		Number(d),
		Number(h ?? 0),
		Number(mi ?? 0),
		Number(s ?? 0),
		Number((frac ?? '.0').slice(1, 4).padEnd(3, '0')),
	);
	const date = `${y}-${mo}-${d}`;
	if (Number.isNaN(digitsMs) || formatDigits(digitsMs).slice(0, 10) !== date) {
		return undefined; // 2026-02-30 and the like
	}
	return {
		date,
		...(h !== undefined ? { clock: `${h}:${mi}:${s ?? '00'}${fraction(frac)}` } : {}),
		digitsMs,
		...(zone !== undefined ? { offsetMinutes: parseOffset(zone) } : {}),
	};
}

/** `YYYY-MM-DDTHH:mm:ss[.fff]` of UTC-epoch milliseconds read as plain digits. */
function formatDigits(ms: number): string {
	const iso = new Date(ms).toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
	const millis = iso.slice(20, 23);
	return iso.slice(0, 19) + (millis === '000' ? '' : `.${millis}`);
}

/** The clock of a Time value: `HH:mm[:ss[.f]]` or the time part of a date-time literal. */
function parseClock(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const m = CLOCK_RE.exec(value.trim());
		if (m) {
			const [, h, mi, s, frac] = m;
			return Number(h) < 24 && Number(mi) < 60 && Number(s ?? 0) < 60
				? `${h}:${mi}:${s ?? '00'}${fraction(frac)}`
				: undefined;
		}
	}
	return parseDateTime(value)?.clock;
}

/**
 * The single date/time contract between the tools and Creatio, bound to one user's profile time
 * zone (Creatio's own notion of "local": the Creatio UI shows and the DataService API reads and
 * writes every DateTime in it).
 *
 * The tools' contract:
 * - IN, DateTime: a zone-less value is the user's wall clock (as Creatio itself reads it); a value
 *   with `Z` or an offset is that exact instant. A date alone means the user's midnight.
 * - IN, Date: the calendar date as written (any time or zone is ignored). Time: the clock as written.
 * - OUT, DateTime: the user's wall clock labelled with the user's offset on that date
 *   (`2026-11-10T15:00:00-01:00`) — the digits are the ones Creatio shows; Date: `YYYY-MM-DD`;
 *   Time: `HH:mm:ss`.
 *
 * Each backend speaks its own dialect: DataService takes and returns the zone-less wall clock
 * (`toWallClock` / `fromWallClock`), OData takes and returns UTC instants (`toInstant` /
 * `fromInstant`). A value that is not a date/time literal passes through unchanged, so Creatio
 * reports it as it would.
 */
export class UserClock {
	public readonly zone: ZoneRules;

	constructor(zone: ZoneRules) {
		this.zone = zone;
	}

	private _instantOf(literal: DateTimeLiteral): number {
		return literal.offsetMinutes === undefined
			? wallClockToUtc(literal.digitsMs, this.zone)
			: literal.digitsMs - literal.offsetMinutes * MINUTE_MS;
	}

	private _labelled(utcMs: number): string {
		return (
			formatDigits(utcToWallClock(utcMs, this.zone)) +
			formatOffset(this.zone.offsetMinutesAt(utcMs))
		);
	}

	/** A tool input → DataService's zone-less wall clock. Never sends `Z` or an offset: DataService
	 *  applies an offset in the SERVER's zone, and an UpdateQuery silently skips a `Z` value whose
	 *  UTC digits equal the stored local digits (both measured live). */
	public toWallClock(kind: TemporalKind, value: unknown): unknown {
		if (kind === 'time') {
			const clock = parseClock(value);
			return clock ? `${TIME_EPOCH_DATE}T${clock}` : value;
		}
		const literal = parseDateTime(value);
		if (!literal) {
			return value;
		}
		if (kind === 'date') {
			return `${literal.date}T00:00:00`;
		}
		return literal.offsetMinutes === undefined
			? formatDigits(literal.digitsMs)
			: formatDigits(utcToWallClock(this._instantOf(literal), this.zone));
	}

	/** A tool input → OData's UTC instant (`…Z`). A Date column keeps its calendar date: OData stores
	 *  the date part of the value as written. A Time value is passed through. */
	public toInstant(kind: TemporalKind, value: unknown): unknown {
		const literal = kind === 'time' ? undefined : parseDateTime(value);
		if (!literal) {
			return value;
		}
		if (kind === 'date') {
			return `${literal.date}T00:00:00Z`;
		}
		return `${formatDigits(this._instantOf(literal))}Z`;
	}

	/** A DataService cell (the user's zone-less wall clock) → the tool output. */
	public fromWallClock(kind: TemporalKind, cell: unknown): unknown {
		if (kind === 'time') {
			return parseClock(cell) ?? cell;
		}
		const literal = parseDateTime(cell);
		if (!literal || literal.offsetMinutes !== undefined) {
			return cell;
		}
		return kind === 'date' ? literal.date : this._labelled(this._instantOf(literal));
	}

	/** An OData cell (a UTC instant; a Date column's calendar date labelled `Z`) → the tool output. */
	public fromInstant(kind: TemporalKind, cell: unknown): unknown {
		const literal = kind === 'time' ? undefined : parseDateTime(cell);
		if (!literal) {
			return cell;
		}
		if (kind === 'date') {
			return literal.date;
		}
		return literal.offsetMinutes === undefined
			? cell
			: this._labelled(this._instantOf(literal));
	}
}

/** Whether a value looks like a date/time literal (decides if a filter needs schema + clock). */
export function isTemporalLiteral(value: unknown): boolean {
	return value instanceof Date || parseDateTime(value) !== undefined;
}

/** Whether a date/time literal states its zone (`Z` or an offset). */
export function hasExplicitZone(value: unknown): boolean {
	return parseDateTime(value)?.offsetMinutes !== undefined;
}
