import { FilterNode } from '../contracts';

import { TemporalKind, hasExplicitZone, isTemporalLiteral } from './user-clock';

/** Converts one filter value of a temporal column into a backend's dialect. */
export type TemporalValueMapper = (kind: TemporalKind, value: unknown) => unknown;

/** The kind to assume for a date/time value whose column kind is unknown (no schema, or a path the
 *  schema cannot resolve); `undefined` leaves the value as written. */
export type UnknownKindPolicy = (value: unknown) => TemporalKind | undefined;

/** A zone only means something for a DateTime: convert a zoned value as one, leave the rest. */
export const ZONED_AS_DATETIME: UnknownKindPolicy = (value) =>
	hasExplicitZone(value) ? 'datetime' : undefined;

function conditions(node: FilterNode): Array<{ field: string; values: unknown[] }> {
	if (node.kind === 'group') {
		return node.items.flatMap(conditions);
	}
	return [{ field: node.field, values: node.kind === 'in' ? node.values : [node.value] }];
}

/** The fields a filter compares to a date/time literal — the only ones whose column kind a read
 *  must resolve (and only then does it need the user's zone). */
export function temporalFilterFields(node: FilterNode | undefined): string[] {
	if (!node) {
		return [];
	}
	const fields = conditions(node)
		.filter((c) => c.values.some(isTemporalLiteral))
		.map((c) => c.field);
	return [...new Set(fields)];
}

/** Whether a filter compares anything to a date/time literal. */
export function hasTemporalFilterValue(node: FilterNode | undefined): boolean {
	return temporalFilterFields(node).length > 0;
}

/**
 * The filter with every date/time value converted by `map`, by the kind of its column: `kinds` maps a
 * filter field (a column or a related path such as `Activity.StartDate`) to its kind, and
 * `unknownKind` decides for a field missing from it. Non-temporal values are left untouched.
 */
export function mapTemporalFilterValues(
	node: FilterNode,
	kinds: ReadonlyMap<string, TemporalKind>,
	map: TemporalValueMapper,
	unknownKind: UnknownKindPolicy = ZONED_AS_DATETIME,
): FilterNode {
	const convert = (field: string, value: unknown): unknown => {
		if (!isTemporalLiteral(value)) {
			return value;
		}
		const kind = kinds.get(field) ?? unknownKind(value);
		return kind ? map(kind, value) : value;
	};
	switch (node.kind) {
		case 'group':
			return {
				...node,
				items: node.items.map((n) => mapTemporalFilterValues(n, kinds, map, unknownKind)),
			};
		case 'in':
			return { ...node, values: node.values.map((v) => convert(node.field, v)) };
		default:
			return 'value' in node ? { ...node, value: convert(node.field, node.value) } : node;
	}
}
