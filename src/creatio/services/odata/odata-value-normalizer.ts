import { isEmptyPlaceholder } from '../identifiers';

/**
 * Replaces OData's "no value" placeholders (the empty GUID of an unset lookup, `0001-01-01` of an
 * unset date) with `null`, recursing into `$expand`-ed navigation objects and collections.
 */
export function normalizeODataValue(value: unknown): unknown {
	if (isEmptyPlaceholder(value)) {
		return null;
	}
	if (Array.isArray(value)) {
		return value.map(normalizeODataValue);
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			out[key] = normalizeODataValue(inner);
		}
		return out;
	}
	return value;
}
