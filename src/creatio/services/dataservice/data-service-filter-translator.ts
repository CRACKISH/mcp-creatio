import { FilterComparison, FilterCondition, FilterInCondition, FilterNode } from '../../contracts';

import {
	DataServiceExpression,
	DataServiceFilter,
	DataServiceFilters,
	DataValueType,
	ExpressionType,
	FilterComparisonType,
	FilterType,
	LogicalOperation,
} from './data-service-types';
import {
	encodeParameterValue,
	inferDataValueType,
	ValueTypeResolver,
} from './data-service-value-type';

const COMPARISON: Record<Exclude<FilterComparison, 'isNull' | 'isNotNull'>, FilterComparisonType> = {
	eq: FilterComparisonType.Equal,
	ne: FilterComparisonType.NotEqual,
	gt: FilterComparisonType.Greater,
	ge: FilterComparisonType.GreaterOrEqual,
	lt: FilterComparisonType.Less,
	le: FilterComparisonType.LessOrEqual,
	contains: FilterComparisonType.Contain,
	startswith: FilterComparisonType.StartWith,
	endswith: FilterComparisonType.EndWith,
};

/**
 * Projects a neutral {@link FilterNode} tree onto a Creatio DataService `Filters` tree.
 * Groups become `FilterType.Group` with a keyed `items` map; comparisons become
 * `FilterType.CompareFilter` with a column `LeftExpression` and a typed-parameter
 * `RightExpression`; `isNull`/`isNotNull` become `FilterType.IsNullFilter`. An `in` list is
 * expanded to an OR-group of equalities (DataService has no native IN in our op subset).
 */
export class DataServiceFilterTranslator {
	private readonly _resolveType: ValueTypeResolver;

	constructor(resolveType: ValueTypeResolver = inferDataValueType) {
		this._resolveType = resolveType;
	}

	private _column(field: string): DataServiceExpression {
		return { expressionType: ExpressionType.SchemaColumn, columnPath: field };
	}

	private _parameter(field: string, value: unknown): DataServiceExpression {
		const dataValueType = this._resolveType(field, value);
		return {
			expressionType: ExpressionType.Parameter,
			parameter: { dataValueType, value: encodeParameterValue(dataValueType, value) },
		};
	}

	private _compare(field: string, op: FilterComparison, value: unknown): DataServiceFilter {
		return {
			filterType: FilterType.CompareFilter,
			comparisonType: COMPARISON[op as Exclude<FilterComparison, 'isNull' | 'isNotNull'>],
			leftExpression: this._column(field),
			rightExpression: this._parameter(field, value),
		};
	}

	private _condition(node: FilterCondition): DataServiceFilter {
		if (node.op === 'isNull' || node.op === 'isNotNull') {
			return {
				filterType: FilterType.IsNullFilter,
				comparisonType:
					node.op === 'isNull'
						? FilterComparisonType.IsNull
						: FilterComparisonType.IsNotNull,
				leftExpression: this._column(node.field),
			};
		}
		return this._compare(node.field, node.op, node.value);
	}

	private _group(
		logic: LogicalOperation,
		children: Array<DataServiceFilter | undefined>,
	): DataServiceFilter | undefined {
		const items: Record<string, DataServiceFilter> = {};
		let n = 0;
		for (const child of children) {
			if (child) {
				items[`item${++n}`] = child;
			}
		}
		if (n === 0) {
			return undefined;
		}
		if (n === 1) {
			return items.item1; // collapse a single-child group
		}
		return { filterType: FilterType.Group, logicalOperation: logic, items };
	}

	private _in(node: FilterInCondition): DataServiceFilter | undefined {
		return this._group(
			LogicalOperation.Or,
			node.values.map((v) => this._compare(node.field, 'eq', v)),
		);
	}

	private _node(node: FilterNode): DataServiceFilter | undefined {
		if (node.kind === 'condition') {
			return this._condition(node);
		}
		if (node.kind === 'in') {
			return this._in(node);
		}
		return this._group(
			node.logic === 'or' ? LogicalOperation.Or : LogicalOperation.And,
			node.items.map((n) => this._node(n)),
		);
	}

	/** Build the root `Filters` for a schema, or undefined when the tree is empty. */
	public translate(
		rootSchemaName: string,
		node: FilterNode | undefined,
	): DataServiceFilters | undefined {
		if (!node) {
			return undefined;
		}
		const filter = this._node(node);
		if (!filter) {
			return undefined;
		}
		return { ...filter, rootSchemaName };
	}
}
