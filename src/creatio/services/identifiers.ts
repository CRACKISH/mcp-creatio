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

/** Creatio's "no reference" GUID: an unset lookup, or "generate one" in id-taking services. */
export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

// OData's "no value" for a date/time column (`DateTime.MinValue`), with or without time/zone.
const MIN_DATE_RE = /^0001-01-01(T00:00:00(\.0+)?(Z|[+-]00:00)?)?$/;

/** Whether a raw cell is one of the platform's placeholders for "no value". */
export function isEmptyPlaceholder(value: unknown): boolean {
	return typeof value === 'string' && (value === EMPTY_GUID || MIN_DATE_RE.test(value));
}

export function isGuid(value: unknown): value is string {
	return typeof value === 'string' && GUID_RE.test(value);
}

export function isIsoDateLike(value: string): boolean {
	return ISO_DATETIME_RE.test(value);
}
