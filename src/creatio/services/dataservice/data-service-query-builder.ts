import { OrderSpec, ReadQuery } from '../../contracts';
import { lookupIdPath } from '../lookup-path';

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

	public buildSelectQuery(query: ReadQuery): DataServiceSelectQuery {
		const orderByPath = this._orderMap(query.order);
		const items: Record<string, DataServiceSelectColumn> = {};
		const selected = query.columns && query.columns.length > 0 ? query.columns : [];
		for (const requested of selected) {
			// The response is keyed by the item KEY, so keep the caller's requested name as the
			// alias and normalize only the columnPath: OData-style `/` -> DataService `.`, and a
			// scalar lookup FK (`TypeId`) -> its primary-key path (`Type.Id`). A bare lookup
			// (`Type`) is left as-is so DataService returns its display value.
			const columnPath = lookupIdPath(requested.replace(/\//g, '.'), '.');
			const column: DataServiceSelectColumn = {
				expression: { expressionType: ExpressionType.SchemaColumn, columnPath },
			};
			const hint = orderByPath.get(requested);
			if (hint) {
				column.orderDirection = hint.dir;
				column.orderPosition = hint.pos;
			}
			items[requested] = column;
		}

		const select: DataServiceSelectQuery = {
			rootSchemaName: query.entity,
			operationType: QueryOperationType.Select,
			columns: { items },
			allColumns: selected.length === 0,
		};
		const filters = this._filters.translate(query.entity, query.filter);
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
	public buildCountQuery(query: ReadQuery): DataServiceSelectQuery {
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
		const filters = this._filters.translate(query.entity, query.filter);
		if (filters) {
			select.filters = filters;
		}
		return select;
	}
}
