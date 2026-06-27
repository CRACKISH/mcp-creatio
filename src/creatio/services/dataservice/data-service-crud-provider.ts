import log from '../../../log';
import {
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
} from '../../contracts';
import { CreatioHttpClient } from '../http-client';

import { buildColumnValues, makeTypeResolver } from './data-service-column-values';
import { DataServiceFilterTranslator } from './data-service-filter-translator';
import { COUNT_COLUMN_ALIAS, DataServiceQueryBuilder } from './data-service-query-builder';
import { DataServiceSchemaProvider } from './data-service-schema';
import { DataServiceFilters, DataServiceSelectQuery, QueryOperationType } from './data-service-types';
import { DataServiceTransport } from './data-service-transport';

const ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const PRIMARY_KEY = 'Id';

/**
 * DataService-backed CRUD provider (alternative to OData, selected via
 * `CREATIO_CRUD_BACKEND=dataservice`). Talks to `/0/DataService/json/SyncReply/*` using the
 * neutral query contract end to end:
 * - read    -> SelectQuery (+ a COUNT aggregation query when `count`),
 * - create  -> InsertQuery with type-coerced ColumnValues,
 * - update  -> UpdateQuery (id -> Filters{ Id eq … }) + ColumnValues,
 * - delete  -> DeleteQuery (id -> Filters{ Id eq … }),
 * - schema  -> RuntimeEntitySchemaRequest / VwSysSchemaInWorkspace (see schema provider).
 * Column values are typed from authoritative entity metadata, falling back to a heuristic.
 */
export class DataServiceCrudProvider implements CrudProvider {
	private readonly _transport: DataServiceTransport;
	private readonly _queryBuilder: DataServiceQueryBuilder;
	private readonly _filters: DataServiceFilterTranslator;
	private readonly _schema: DataServiceSchemaProvider;

	public readonly kind = 'creatio-dataservice';

	constructor(
		client: CreatioHttpClient,
		deps: {
			transport?: DataServiceTransport;
			queryBuilder?: DataServiceQueryBuilder;
			filters?: DataServiceFilterTranslator;
			schema?: DataServiceSchemaProvider;
		} = {},
	) {
		this._transport = deps.transport ?? new DataServiceTransport(client);
		this._queryBuilder = deps.queryBuilder ?? new DataServiceQueryBuilder();
		this._filters = deps.filters ?? new DataServiceFilterTranslator();
		this._schema = deps.schema ?? new DataServiceSchemaProvider(this._transport);
	}

	/** Visible for tests: build (don't send) the SelectQuery payload. */
	public buildSelectQuery(query: ReadQuery): DataServiceSelectQuery {
		return this._queryBuilder.buildSelectQuery(query);
	}

	private _validateEntityName(entity: string): string {
		// DataService schema names are simple identifiers; reject anything else so a name can
		// never alter the request envelope or be used for injection.
		if (!entity || !ENTITY_NAME_PATTERN.test(entity)) {
			throw new Error(`invalid_entity_name:${entity}`);
		}
		return entity;
	}

	private _rows(body: any): any[] {
		return Array.isArray(body?.rows) ? body.rows : [];
	}

	private _extractCount(body: any): number | undefined {
		const rows = this._rows(body);
		const raw = rows.length ? rows[0]?.[COUNT_COLUMN_ALIAS] : undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	/** Filter selecting a single record by primary key (id-addressed update/delete -> set-based). */
	private _byIdFilter(entity: string, id: string): DataServiceFilters {
		const filters = this._filters.translate(entity, {
			kind: 'condition',
			field: PRIMARY_KEY,
			op: 'eq',
			value: id,
		});
		if (!filters) {
			throw new Error(`invalid_record_id:${id}`);
		}
		return filters;
	}

	private async _columnValues(entity: string, data: Record<string, unknown>) {
		const types = await this._schema.columnTypes(entity);
		return buildColumnValues(data, makeTypeResolver(types));
	}

	public listEntitySets(): Promise<string[]> {
		return this._schema.listEntitySets();
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._schema.describeEntity(this._validateEntityName(entitySet));
	}

	public async read(query: ReadQuery): Promise<ReadResult> {
		this._validateEntityName(query.entity);
		const select = this._queryBuilder.buildSelectQuery(query);
		const body = await this._transport.post('SelectQuery', select, {
			logContext: { entity: query.entity, top: query.top, skip: query.skip },
		});
		const items = this._rows(body);
		if (body?.notFoundColumns?.length) {
			log.warn('creatio.dataservice.read.not_found_columns', {
				entity: query.entity,
				notFoundColumns: body.notFoundColumns,
			});
		}
		if (!query.count) {
			return { items };
		}
		const countBody = await this._transport.post(
			'SelectQuery',
			this._queryBuilder.buildCountQuery(query),
			{ logContext: { entity: query.entity, count: true } },
		);
		const totalCount = this._extractCount(countBody);
		return totalCount !== undefined ? { items, totalCount } : { items };
	}

	public async create({ entity, data }: CrudWriteParams): Promise<any> {
		this._validateEntityName(entity);
		const columnValues = await this._columnValues(entity, data ?? {});
		const body = await this._transport.post(
			'InsertQuery',
			{ rootSchemaName: entity, operationType: QueryOperationType.Insert, columnValues },
			{ logContext: { entity }, checkSuccess: true },
		);
		return { id: body?.id, success: body?.success !== false, rowsAffected: body?.rowsAffected };
	}

	public async update({ entity, id, data }: CrudUpdateParams): Promise<any> {
		this._validateEntityName(entity);
		const columnValues = await this._columnValues(entity, data ?? {});
		const body = await this._transport.post(
			'UpdateQuery',
			{
				rootSchemaName: entity,
				operationType: QueryOperationType.Update,
				columnValues,
				filters: this._byIdFilter(entity, id),
			},
			{ logContext: { entity, id }, checkSuccess: true },
		);
		return { success: body?.success !== false, rowsAffected: body?.rowsAffected };
	}

	public async delete({ entity, id }: CrudDeleteParams): Promise<any> {
		this._validateEntityName(entity);
		const body = await this._transport.post(
			'DeleteQuery',
			{
				rootSchemaName: entity,
				operationType: QueryOperationType.Delete,
				filters: this._byIdFilter(entity, id),
			},
			{ logContext: { entity, id }, checkSuccess: true },
		);
		return { success: body?.success !== false, rowsAffected: body?.rowsAffected };
	}
}
