import { OrderSpec, ReadQuery } from '../../contracts';

import { DataServiceFilterTranslator } from './data-service-filter-translator';
import {
	DataServiceSelectColumn,
	DataServiceSelectQuery,
	ExpressionType,
	OrderDirection,
	QueryOperationType,
} from './data-service-types';

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

	private _orderMap(order: OrderSpec[] | undefined): Map<string, { dir: OrderDirection; pos: number }> {
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
		for (const path of selected) {
			const column: DataServiceSelectColumn = {
				expression: { expressionType: ExpressionType.SchemaColumn, columnPath: path },
			};
			const hint = orderByPath.get(path);
			if (hint) {
				column.orderDirection = hint.dir;
				column.orderPosition = hint.pos;
			}
			items[path] = column;
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
		if (typeof query.top === 'number') {
			select.rowCount = query.top;
			select.isPageable = true;
		}
		if (typeof query.skip === 'number' && query.skip > 0) {
			select.rowsOffset = query.skip;
		}
		return select;
	}
}
