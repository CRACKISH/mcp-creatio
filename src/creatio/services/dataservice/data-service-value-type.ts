import { DataValueType } from './data-service-types';

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

/** Encode a JS value for a DataService `Parameter.value` given its resolved type. */
export function encodeParameterValue(type: DataValueType, value: unknown): unknown {
	if (value === null || value === undefined) {
		return null;
	}
	if (type === DataValueType.DateTime || type === DataValueType.Date || type === DataValueType.Time) {
		return value instanceof Date ? value.toISOString() : value;
	}
	return value;
}
