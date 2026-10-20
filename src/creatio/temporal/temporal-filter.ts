import { FilterNode } from '../contracts';

import { TemporalKind, hasExplicitZone, isTemporalLiteral } from './user-clock';

/** Converts one filter value of a temporal column into a backend's dialect. */
export type TemporalValueMapper = (kind: TemporalKind, value: unknown) => unknown;

function values(node: FilterNode): unknown[] {
	if (node.kind === 'group') {
		return node.items.flatMap(values);
	}
	return node.kind === 'in' ? node.values : [node.value];
}

/** Whether a filter compares anything to a date/time literal — only then does a read need the
 *  column types and the user's zone. */
export function hasTemporalFilterValue(node: FilterNode | undefined): boolean {
	return Boolean(node) && values(node!).some(isTemporalLiteral);
}

/**
 * The filter with every date/time value converted by `map`, by the kind of its column. A top-level
 * column's kind comes from the entity schema (`kinds`); a related path (`Account.CreatedOn`) is
 * another entity's column, so only a value that states its zone is converted there — as a DateTime,
 * the one kind for which a zone means anything. Non-temporal values are left untouched.
 */
export function mapTemporalFilterValues(
	node: FilterNode,
	kinds: ReadonlyMap<string, TemporalKind>,
	map: TemporalValueMapper,
): FilterNode {
	const convert = (field: string, value: unknown): unknown => {
		if (!isTemporalLiteral(value)) {
			return value;
		}
		const kind = kinds.get(field) ?? (hasExplicitZone(value) ? 'datetime' : undefined);
		return kind ? map(kind, value) : value;
	};
	switch (node.kind) {
		case 'group':
			return {
				...node,
				items: node.items.map((n) => mapTemporalFilterValues(n, kinds, map)),
			};
		case 'in':
			return { ...node, values: node.values.map((v) => convert(node.field, v)) };
		default:
			return 'value' in node ? { ...node, value: convert(node.field, node.value) } : node;
	}
}
