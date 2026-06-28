/**
 * Creatio identifier shapes shared across both CRUD backends (OData + DataService) — the single
 * source of truth for "what a Creatio key/date literal looks like". Previously duplicated (and
 * already drifting) across the two translators, the OData provider, and the DataService coercion.
 */

export const GUID_RE =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Strict ISO-8601 date / date-time, so arbitrary text is never misread as a date.
export const ISO_DATETIME_RE =
	/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isGuid(value: unknown): value is string {
	return typeof value === 'string' && GUID_RE.test(value);
}

export function isIsoDateLike(value: string): boolean {
	return ISO_DATETIME_RE.test(value);
}
