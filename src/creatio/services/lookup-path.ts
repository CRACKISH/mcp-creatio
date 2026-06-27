/**
 * Navigate a scalar lookup foreign key, compared to a GUID, to its primary-key path — for
 * the given separator (`/` for OData, `.` for DataService). A lookup FK compared to a GUID
 * means "match that related record by Id", which both dialects express by navigating to the
 * lookup's `Id`:
 *
 *   TypeId             -> Type{sep}Id              (scalar FK)
 *   Contact{sep}TypeId -> Contact{sep}Type{sep}Id  (nested scalar FK)
 *
 * Navigation only fires when the final segment carries an `Id` suffix (the foreign-key
 * signal) — without schema we must NOT assume an arbitrary GUID-valued column is a lookup,
 * so `Name`, `Owner`, `Contact/Type` are left as-is (to filter those, name the FK: `OwnerId`,
 * `Contact/TypeId`, or navigate explicitly: `Contact/Type/Id`). A path that is already the
 * key (`Id`) or already ends in `{sep}Id` is returned unchanged. Callers apply this ONLY when
 * the compared value is a GUID, so plain string/number filters are never rewritten.
 */
export function lookupIdPath(field: string, sep: '/' | '.'): string {
	if (field === 'Id' || field.endsWith(`${sep}Id`)) {
		return field;
	}
	const segments = field.split(sep);
	const lastIndex = segments.length - 1;
	const last = segments[lastIndex] as string;
	if (!/Id$/.test(last)) {
		return field; // no foreign-key signal — don't assume a lookup
	}
	segments[lastIndex] = last.slice(0, -2);
	return `${segments.join(sep)}${sep}Id`;
}
