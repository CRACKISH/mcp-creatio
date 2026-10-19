import { FilterNode, ReadQuery } from '../contracts';

/** Names of an entity's lookup (navigation) columns, e.g. `Account`, `Owner`. */
export type LookupNames = ReadonlySet<string>;

const ID_SUFFIX = /Id$/;

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
 * signal), so `Name`, `Owner`, `Contact/Type` are left as-is (to filter those, name the FK:
 * `OwnerId`, `Contact/TypeId`, or navigate explicitly: `Contact/Type/Id`). A path that is
 * already the key (`Id`) or already ends in `{sep}Id` is returned unchanged.
 *
 * With the entity's `lookups` known, a top-level `XxxId` is navigated ONLY when `Xxx` is one of
 * them: a genuine GUID column such as `SysFile.RecordId` must stay as-is (verified live — the
 * rewrite 400s on OData and is a "not found" column on DataService). Without them, or for a nested
 * path (its last segment belongs to another entity), the `Id`-suffix heuristic applies.
 */
export function lookupIdPath(field: string, sep: '/' | '.', lookups?: LookupNames): string {
	if (field === 'Id' || field.endsWith(`${sep}Id`)) {
		return field;
	}
	const segments = field.split(sep);
	const lastIndex = segments.length - 1;
	const last = segments[lastIndex] as string;
	if (!ID_SUFFIX.test(last)) {
		return field; // no foreign-key signal — don't assume a lookup
	}
	if (lookups && segments.length === 1 && !lookups.has(last.slice(0, -2))) {
		return field; // a real column of its own (not `<lookup>Id`)
	}
	segments[lastIndex] = last.slice(0, -2);
	return `${segments.join(sep)}${sep}Id`;
}

function filterFields(node: FilterNode | undefined): string[] {
	if (!node) {
		return [];
	}
	return node.kind === 'group' ? node.items.flatMap(filterFields) : [node.field];
}

/**
 * Whether resolving the query's fields needs the entity's lookup names: only a top-level
 * `XxxId` is ambiguous (lookup FK vs. a real column), so other queries skip the schema lookup.
 */
export function needsLookupNames(query: ReadQuery): boolean {
	const fields = [
		...(query.columns ?? []),
		...(query.order ?? []).map((o) => o.field),
		...filterFields(query.filter),
	];
	return fields.some((f) => f !== 'Id' && ID_SUFFIX.test(f) && !/[./]/.test(f));
}
