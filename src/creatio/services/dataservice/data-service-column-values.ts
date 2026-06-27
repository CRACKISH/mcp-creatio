import { DataServiceColumnValues, DataValueType, ExpressionType } from './data-service-types';
import {
	encodeParameterValue,
	inferDataValueType,
	isGuid,
	toParameterDataValueType,
	ValueTypeResolver,
} from './data-service-value-type';

/**
 * Build a type resolver from an authoritative column->{@link DataValueType} map (from
 * `RuntimeEntitySchemaRequest`). Falls back to the per-value heuristic for unknown columns.
 * A Lookup column written with a bare GUID is typed as Guid so the lookup is set by its
 * foreign key (DataService's Lookup type expects a lookup object, not a raw id).
 */
export function makeTypeResolver(types: Map<string, DataValueType>): ValueTypeResolver {
	return (field, value) => {
		const known = types.get(field);
		if (known === undefined) {
			return inferDataValueType(field, value);
		}
		// Map the (possibly extended) column type down to a base Parameter type.
		const base = toParameterDataValueType(known);
		if (base === DataValueType.Lookup && isGuid(value)) {
			return DataValueType.Guid;
		}
		return base;
	};
}

/** Project a plain data object onto a DataService `ColumnValues` map of typed parameters. */
export function buildColumnValues(
	data: Record<string, unknown> | undefined,
	resolveType: ValueTypeResolver,
): DataServiceColumnValues {
	const items: DataServiceColumnValues['items'] = {};
	for (const [column, raw] of Object.entries(data ?? {})) {
		const dataValueType = resolveType(column, raw);
		items[column] = {
			expressionType: ExpressionType.Parameter,
			parameter: { dataValueType, value: encodeParameterValue(dataValueType, raw) },
		};
	}
	return { items };
}
