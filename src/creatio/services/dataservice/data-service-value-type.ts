import { DataValueType } from './data-service-types';

/** Resolves the {@link DataValueType} for a column value (schema-aware or heuristic). */
export type ValueTypeResolver = (field: string, value: unknown) => DataValueType;

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Strict ISO-8601 date / datetime (so arbitrary text is never misread as a date).
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isGuid(value: unknown): value is string {
	return typeof value === 'string' && GUID.test(value);
}

/**
 * Best-effort {@link DataValueType} for a value when authoritative entity metadata is not
 * available. This is the FALLBACK only — write paths should prefer the column's real type
 * from `RuntimeEntitySchemaRequest`; the platform never infers the type itself (an absent
 * type silently defaults to Text and breaks non-text columns), so a sensible guess beats none.
 * Mirrors the heuristic used by the reference DataService client (`*Id` -> Guid, etc.).
 */
export function inferDataValueType(field: string, value: unknown): DataValueType {
	if (value === null || value === undefined) {
		return DataValueType.Text;
	}
	if (typeof value === 'boolean') {
		return DataValueType.Boolean;
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? DataValueType.Integer : DataValueType.Float;
	}
	if (value instanceof Date) {
		return DataValueType.DateTime;
	}
	if (typeof value === 'string') {
		if (isGuid(value)) {
			return DataValueType.Guid;
		}
		if (ISO_DATETIME.test(value)) {
			return DataValueType.DateTime;
		}
	}
	return DataValueType.Text;
}

// Extended `DataValueType` codes (column storage types) grouped by the BASE type a
// DataService query Parameter accepts. RuntimeEntitySchemaRequest returns the extended codes
// (e.g. MediumText=28), but a Parameter typed with an extended code 500s
// ("NotSupportedException: MediumText"), so writes must map column types down to the base.
const TEXT_TYPES = new Set([1, 23, 24, 27, 28, 29, 30, 36, 42, 43, 44, 45]);
const INTEGER_TYPES = new Set([4, 11, 17]);
const FLOAT_TYPES = new Set([5, 31, 32, 33, 34, 40, 47]);
const MONEY_TYPES = new Set([6, 48, 49, 50]);
const LOOKUP_TYPES = new Set([10, 16]);
const BINARY_TYPES = new Set([13, 14, 25]);

/** Map a (possibly extended) column {@link DataValueType} to the base type usable as a
 *  DataService query/insert Parameter. */
export function toParameterDataValueType(dataValueType: number): DataValueType {
	if (TEXT_TYPES.has(dataValueType)) return DataValueType.Text;
	if (INTEGER_TYPES.has(dataValueType)) return DataValueType.Integer;
	if (FLOAT_TYPES.has(dataValueType)) return DataValueType.Float;
	if (MONEY_TYPES.has(dataValueType)) return DataValueType.Money;
	if (LOOKUP_TYPES.has(dataValueType)) return DataValueType.Lookup;
	if (BINARY_TYPES.has(dataValueType)) return DataValueType.Binary;
	if (
		dataValueType === DataValueType.Guid ||
		dataValueType === DataValueType.DateTime ||
		dataValueType === DataValueType.Date ||
		dataValueType === DataValueType.Time ||
		dataValueType === DataValueType.Boolean
	) {
		return dataValueType;
	}
	return DataValueType.Text;
}

/**
 * Encode a JS value for a DataService `Parameter.value`. Date/time values are special: the
 * platform expects the JSON-quoted local wall-clock WITHOUT a `Z`/offset (mirrors the devkit's
 * `ɵencodeDate`, which returns `"<iso-no-Z>"`), and interprets it in the user-profile timezone
 * on the server. A raw ISO string with `Z` is NOT parsed (500 "value cannot be null").
 *
 * We treat the incoming wall-clock as-is (the env user is UTC, and the tool convention is to
 * pass UTC) and strip the trailing `Z`/offset. NOTE: for a non-UTC user profile, a UTC input
 * would need converting to the profile offset first — tracked as a follow-up.
 */
export function encodeParameterValue(type: DataValueType, value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}
	if (type === DataValueType.DateTime || type === DataValueType.Date || type === DataValueType.Time) {
		const iso = value instanceof Date ? value.toISOString() : String(value);
		const wallClock = iso.replace(/Z$/i, '').replace(/[+-]\d{2}:?\d{2}$/, '');
		return `"${wallClock}"`;
	}
	return value;
}
