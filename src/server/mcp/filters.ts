import { FilterComparison, FilterNode, OrderSpec } from '../../creatio/contracts';

/**
 * Compiles the tool-level structured `filters` argument (`{ all?: [...], any?: [...] }`) into
 * the backend-agnostic {@link FilterNode} AST. This is the boundary between the MCP tool
 * surface and the neutral query contract — it knows the tool's `{field, op, value | in}`
 * shape but NOTHING about OData or DataService. Each provider's translator turns the AST
 * into its own dialect, so all dialect quirks live below this layer, not here.
 */

interface RawCondition {
	field?: unknown;
	op?: unknown;
	value?: unknown;
	in?: unknown[];
}

interface RawFilters {
	all?: RawCondition[];
	any?: RawCondition[];
}

function toNode(c: RawCondition): FilterNode | undefined {
	if (!c || !c.field) {
		return undefined;
	}
	const field = String(c.field);
	if (Array.isArray(c.in)) {
		return c.in.length ? { kind: 'in', field, values: c.in } : undefined;
	}
	const op = (c.op ? String(c.op) : 'eq') as FilterComparison;
	// A null/absent value against eq/ne is a null-check; route it through the dedicated
	// neutral ops so each backend renders it correctly (OData `field eq null`,
	// DataService `IsNullFilter`).
	if (c.value === null || c.value === undefined) {
		if (op === 'eq') {
			return { kind: 'condition', field, op: 'isNull' };
		}
		if (op === 'ne') {
			return { kind: 'condition', field, op: 'isNotNull' };
		}
	}
	return { kind: 'condition', field, op, value: c.value };
}

function group(logic: 'and' | 'or', conditions: RawCondition[]): FilterNode | undefined {
	const items = conditions.map(toNode).filter((n): n is FilterNode => Boolean(n));
	if (!items.length) {
		return undefined;
	}
	return { kind: 'group', logic, items };
}

/** Build the neutral {@link FilterNode} from the structured `filters` argument (AND of the
 *  `all` group with the `any` group), or undefined when there is nothing to filter on. */
export function buildFilterNode(filters: unknown): FilterNode | undefined {
	if (!filters || typeof filters !== 'object') {
		return undefined;
	}
	const f = filters as RawFilters;
	const allNode = Array.isArray(f.all) ? group('and', f.all) : undefined;
	const anyNode = Array.isArray(f.any) ? group('or', f.any) : undefined;
	const parts = [allNode, anyNode].filter((n): n is FilterNode => Boolean(n));
	if (!parts.length) {
		return undefined;
	}
	if (parts.length === 1) {
		return parts[0];
	}
	return { kind: 'group', logic: 'and', items: parts };
}

/** Parse an OData-style `$orderby` clause ("Name asc, CreatedOn desc") into neutral order
 *  terms. Direction defaults to ascending when omitted. */
export function parseOrderBy(orderBy: unknown): OrderSpec[] | undefined {
	if (typeof orderBy !== 'string' || !orderBy.trim()) {
		return undefined;
	}
	const terms = orderBy
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part): OrderSpec => {
			const [field, dir] = part.split(/\s+/);
			return {
				field: field as string,
				dir: (dir ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc',
			};
		});
	return terms.length ? terms : undefined;
}
