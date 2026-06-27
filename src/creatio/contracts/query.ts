/**
 * Backend-agnostic read-query contract — the neutral seam between the MCP tool surface
 * and the concrete data API. The MCP layer compiles tool arguments into a {@link ReadQuery};
 * each CRUD provider owns a translator that projects it onto its own dialect (OData
 * `$filter`/`$select`/`$orderby` or a DataService `Filters` tree + `Columns`). Nothing here
 * is OData- or DataService-specific, which is what lets the two backends be interchangeable.
 */

/** Neutral comparison operators. `isNull`/`isNotNull` take no value. */
export type FilterComparison =
	| 'eq'
	| 'ne'
	| 'gt'
	| 'ge'
	| 'lt'
	| 'le'
	| 'contains'
	| 'startswith'
	| 'endswith'
	| 'isNull'
	| 'isNotNull';

/** A single `field op value` comparison. */
export interface FilterCondition {
	kind: 'condition';
	field: string;
	op: FilterComparison;
	/** Omitted for `isNull`/`isNotNull`. */
	value?: unknown;
}

/** `field IN (…)` — a provider expands it to an OR-group of equalities. */
export interface FilterInCondition {
	kind: 'in';
	field: string;
	values: unknown[];
}

/** A logical grouping of nested nodes (`AND`/`OR`). Enables arbitrary nesting. */
export interface FilterGroup {
	kind: 'group';
	logic: 'and' | 'or';
	items: FilterNode[];
}

export type FilterNode = FilterCondition | FilterInCondition | FilterGroup;

/** One sort term. Providers map it to `$orderby` (OData) or column order hints (DataService). */
export interface OrderSpec {
	field: string;
	dir: 'asc' | 'desc';
}

/**
 * OData-only escape hatches that have no neutral equivalent. The OData provider honors
 * them; other backends ignore them (DataService addresses nested data by column path, not
 * `$expand`, and has no raw-string filter). Kept on a discriminated `odata` bag so they are
 * explicitly non-portable rather than masquerading as part of the neutral contract.
 */
export interface ODataReadExtras {
	/** Raw OData `$filter` expression, passed through verbatim (advanced escape hatch). */
	rawFilter?: string;
	/** OData `$expand` navigation properties. */
	expand?: string[];
}

export interface ReadQuery {
	entity: string;
	/** Columns to project. Empty/undefined = all columns. */
	columns?: string[];
	/** Structured, backend-agnostic filter tree. */
	filter?: FilterNode;
	order?: OrderSpec[];
	top?: number;
	skip?: number;
	/** When true, also resolve the total count of matching rows (ignoring top/skip). */
	count?: boolean;
	/** OData-specific extras; see {@link ODataReadExtras}. */
	odata?: ODataReadExtras;
}

/** Normalized read result, identical across backends. `totalCount` is set only when the
 *  query requested a count. Each provider maps its native envelope (`value`/`@odata.count`
 *  vs `rows`/`rowCount`) onto this shape so callers above the provider never branch on it. */
export interface ReadResult {
	items: unknown[];
	totalCount?: number;
}
