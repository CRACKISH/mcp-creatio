import { OrderSpec, ReadQuery } from '../../contracts';
import { LookupNames, lookupIdPath } from '../lookup-path';

import { DataServiceFilterTranslator } from './data-service-filter-translator';
import {
	AggregationEvalType,
	AggregationType,
	DataServiceSelectColumn,
	DataServiceSelectQuery,
	ExpressionType,
	FunctionType,
	OrderDirection,
	QueryOperationType,
} from './data-service-types';

/** Result-set key under which the count aggregate is returned. */
export const COUNT_COLUMN_ALIAS = 'recordsCount';

/**
 * Pure builder that projects the neutral {@link ReadQuery} onto a Creatio DataService
 * `SelectQuery` payload (columns, paging, sorting, filters). Side-effect free for direct
 * unit testing; the transport lives in {@link DataServiceCrudProvider}.
 */
export class DataServiceQueryBuilder {
	private readonly _filters: DataServiceFilterTranslator;

	constructor(filters = new DataServiceFilterTranslator()) {
		this._filters = filters;
	}

	private _orderMap(
		order: OrderSpec[] | undefined,
	): Map<string, { dir: OrderDirection; pos: number }> {
		const map = new Map<string, { dir: OrderDirection; pos: number }>();
		(order ?? []).forEach((o, i) => {
			map.set(o.field, {
				dir: o.dir === 'desc' ? OrderDirection.Descending : OrderDirection.Ascending,
				pos: i + 1,
			});
		});
		return map;
	}

	/** A column keyed by the caller's requested name (the response is keyed by the item KEY), with
	 *  only the columnPath normalized: OData-style `/` -> DataService `.`, and a scalar lookup FK
	 *  (`TypeId`) -> its primary-key path (`Type.Id`). A bare lookup (`Type`) is left as-is so
	 *  DataService returns its display value. */
	private _column(
		requested: string,
		hint: { dir: OrderDirection; pos: number } | undefined,
		lookups: LookupNames | undefined,
	): DataServiceSelectColumn {
		const columnPath = lookupIdPath(requested.replace(/\//g, '.'), '.', lookups);
		const column: DataServiceSelectColumn = {
			expression: { expressionType: ExpressionType.SchemaColumn, columnPath },
		};
		if (hint) {
			column.orderDirection = hint.dir;
			column.orderPosition = hint.pos;
		}
		return column;
	}

	/**
	 * @param opts.lookups the entity's lookup columns, when known: a top-level `XxxId` is then
	 *   rewritten to `Xxx.Id` only for a real lookup `Xxx` (a genuine `FacebookId` / `RecordId`
	 *   column stays as-is); without them the `Id`-suffix heuristic applies.
	 */
	public buildSelectQuery(
		query: ReadQuery,
		opts: { lookups?: LookupNames } = {},
	): DataServiceSelectQuery {
		const orderByPath = this._orderMap(query.order);
		const items: Record<string, DataServiceSelectColumn> = {};
		const selected = query.columns && query.columns.length > 0 ? query.columns : [];
		for (const requested of selected) {
			items[requested] = this._column(requested, orderByPath.get(requested), opts.lookups);
		}
		// DataService sorts only by columns of the query, so an order term on an unselected field
		// gets its own column (the provider's projection strips it from the result again).
		for (const [field, hint] of orderByPath) {
			if (selected.length > 0 && !items[field]) {
				items[field] = this._column(field, hint, opts.lookups);
			}
		}

		const select: DataServiceSelectQuery = {
			rootSchemaName: query.entity,
			operationType: QueryOperationType.Select,
			columns: { items },
			allColumns: selected.length === 0,
		};
		const filters = this._filters.translate(query.entity, query.filter, opts.lookups);
		if (filters) {
			select.filters = filters;
		}
		// DataService rejects a FETCH of 0 rows (top:0); the provider returns no rows for top:0
		// without sending this query, so only set paging for a positive page size.
		if (typeof query.top === 'number' && query.top > 0) {
			select.rowCount = query.top;
			select.isPageable = true;
		}
		if (typeof query.skip === 'number' && query.skip > 0) {
			select.rowsOffset = query.skip;
		}
		return select;
	}

	/** Build a COUNT(*) SelectQuery over the same filters (ignores paging), used to resolve
	 *  the total when a read requests `count`. The aggregate is returned under
	 *  {@link COUNT_COLUMN_ALIAS} in the single response row. */
	public buildCountQuery(
		query: ReadQuery,
		opts: { lookups?: LookupNames } = {},
	): DataServiceSelectQuery {
		const countColumn: DataServiceSelectColumn = {
			expression: {
				expressionType: ExpressionType.Function,
				functionType: FunctionType.Aggregation,
				functionArgument: { expressionType: ExpressionType.SchemaColumn, columnPath: 'Id' },
				aggregationType: AggregationType.Count,
				aggregationEvalType: AggregationEvalType.None,
			},
		};
		const select: DataServiceSelectQuery = {
			rootSchemaName: query.entity,
			operationType: QueryOperationType.Select,
			columns: { items: { [COUNT_COLUMN_ALIAS]: countColumn } },
			allColumns: false,
		};
		const filters = this._filters.translate(query.entity, query.filter, opts.lookups);
		if (filters) {
			select.filters = filters;
		}
		return select;
	}
}
