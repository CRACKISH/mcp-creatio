import { CrudReadParams } from '../../contracts';

import {
	DataServiceSelectColumn,
	DataServiceSelectQuery,
	ExpressionType,
	OrderDirection,
} from './data-service-types';

/**
 * Pure builder that projects the (currently OData-shaped) {@link CrudReadParams} onto a
 * Creatio DataService `SelectQuery` payload. GROUNDWORK for the planned DataService CRUD
 * provider — it covers the parts that are already backend-agnostic in the contract
 * (columns, paging, sorting). Filter translation is intentionally NOT handled here: the
 * read contract still carries a raw OData `$filter` string, and translating that into a
 * DataService filter tree is the job of the future neutral query-contract rework
 * (audit finding #9), not this skeleton. Kept side-effect free for direct unit testing.
 */
export class DataServiceQueryBuilder {
	/** Parse an OData-style `$orderby` clause ("Name desc, CreatedOn") into column order hints. */
	private _parseOrderBy(orderBy?: string): Array<{ path: string; dir: OrderDirection }> {
		if (!orderBy) {
			return [];
		}
		return orderBy
			.split(',')
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => {
				const [path, dir] = part.split(/\s+/);
				return {
					path: path as string,
					dir:
						(dir ?? '').toLowerCase() === 'desc'
							? OrderDirection.Descending
							: OrderDirection.Ascending,
				};
			});
	}

	public buildSelectQuery(params: CrudReadParams): DataServiceSelectQuery {
		const order = this._parseOrderBy(params.orderBy);
		const orderByPath = new Map(order.map((o, i) => [o.path, { dir: o.dir, pos: i + 1 }]));

		const items: Record<string, DataServiceSelectColumn> = {};
		const selected = params.select && params.select.length > 0 ? params.select : [];
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

		const query: DataServiceSelectQuery = {
			rootSchemaName: params.entity,
			operationType: 0,
			columns: { items },
			allColumns: selected.length === 0,
		};
		if (typeof params.top === 'number') {
			query.rowCount = params.top;
			query.isPageable = true;
		}
		if (typeof params.skip === 'number' && params.skip > 0) {
			query.rowsOffset = params.skip;
		}
		return query;
	}
}
