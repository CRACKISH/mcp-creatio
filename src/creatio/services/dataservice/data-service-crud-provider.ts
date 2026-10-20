import log from '../../../log';
import {
	CrudCapabilities,
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
	UnknownNameError,
} from '../../contracts';
import {
	TemporalKind,
	mapTemporalFilterValues,
	temporalColumns,
	temporalFilterFields,
} from '../../temporal';
import { resolveTemporalKinds } from '../column-schema-source';
import { assertEntityName } from '../entity-name';
import { CreatioHttpClient } from '../http-client';
import { LookupNames, needsLookupNames } from '../lookup-path';
import { SchemaFreshnessGate } from '../schema-freshness-gate';
import { UserClockSource, fixedClockSource } from '../user-time-zone';

import { buildColumnValues, makeTypeResolver } from './data-service-column-values';
import { toUnknownNameError } from './data-service-errors';
import { DataServiceFilterTranslator } from './data-service-filter-translator';
import { COUNT_COLUMN_ALIAS, DataServiceQueryBuilder } from './data-service-query-builder';
import { hasTemporalColumn, normalizeDataServiceRows } from './data-service-row-normalizer';
import { DataServiceSchemaProvider } from './data-service-schema';
import { DataServiceTransport } from './data-service-transport';
import {
	DataServiceFilters,
	DataServiceSelectQuery,
	DataValueType,
	QueryOperationType,
} from './data-service-types';
import { toParameterDataValueType } from './data-service-value-type';

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
	private readonly _clock: UserClockSource;

	public readonly kind = 'creatio-dataservice';
	// DataService has no raw-string filter and no $expand; related data is read by column
	// path and filters are always structured. So neither OData-only extra is offered.
	public readonly capabilities: CrudCapabilities = { rawFilter: false, expand: false };

	constructor(
		client: CreatioHttpClient,
		deps: {
			transport?: DataServiceTransport;
			queryBuilder?: DataServiceQueryBuilder;
			filters?: DataServiceFilterTranslator;
			schema?: DataServiceSchemaProvider;
			freshness?: SchemaFreshnessGate;
			/** The calling user's zone, which DataService reads and writes every DateTime in. */
			clock?: UserClockSource;
		} = {},
	) {
		this._transport = deps.transport ?? new DataServiceTransport(client);
		this._queryBuilder = deps.queryBuilder ?? new DataServiceQueryBuilder();
		this._filters = deps.filters ?? new DataServiceFilterTranslator();
		this._schema =
			deps.schema ??
			new DataServiceSchemaProvider(this._transport, undefined, undefined, deps.freshness);
		this._clock = deps.clock ?? fixedClockSource();
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
		// A scalar lookup FK key (`TypeId`/`OwnerId`) maps to the logical lookup column
		// (`Type`/`Owner`) when the schema exposes it; DataService writes the lookup by that
		// column, not by the `*Id` alias.
		const remapped: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data ?? {})) {
			const column =
				!types.has(key) && key.endsWith('Id') && types.has(key.slice(0, -2))
					? key.slice(0, -2)
					: key;
			remapped[column] = value;
		}
		await this._toWallClocks(remapped, temporalColumns(types));
		return buildColumnValues(remapped, makeTypeResolver(types));
	}

	/** Date/time values in place → the user's zone-less wall clock DataService expects. */
	private async _toWallClocks(
		data: Record<string, unknown>,
		kinds: ReadonlyMap<string, TemporalKind>,
	): Promise<void> {
		const columns = Object.keys(data).filter((column) => kinds.has(column));
		if (!columns.length) {
			return;
		}
		const clock = await this._clock.current();
		for (const column of columns) {
			data[column] = clock.toWallClock(kinds.get(column)!, data[column]);
		}
	}

	/**
	 * The schema facts a read needs, from the cached schema and only when relevant: the lookup
	 * columns that decide whether a top-level `XxxId` is a lookup FK, the column kinds that convert
	 * date/time filter values to the user's wall clock, and — for an ordered read without
	 * `columns`, since DataService ignores sorting in all-columns mode — the full column list.
	 * Without a schema the read keeps the `Id`-suffix heuristic (and an unsorted all-columns read,
	 * logged).
	 */
	private async _resolveRead(
		query: ReadQuery,
	): Promise<{ query: ReadQuery; lookups?: LookupNames }> {
		const expand = Boolean(query.order?.length) && !query.columns?.length;
		const temporalFields = temporalFilterFields(query.filter);
		if (!expand && !temporalFields.length && !needsLookupNames(query)) {
			return { query };
		}
		const types = await this._schema.columnTypes(query.entity);
		if (temporalFields.length) {
			// DataService reads a zone-less value in the user's zone whatever the column kind, so a
			// path the schema cannot resolve keeps its value; a zoned one is converted as a DateTime.
			const [kinds, clock] = await Promise.all([
				resolveTemporalKinds(this._schema, query.entity, temporalFields),
				this._clock.current(),
			]);
			query = {
				...query,
				filter: mapTemporalFilterValues(query.filter!, kinds, (kind, v) =>
					clock.toWallClock(kind, v),
				),
			};
		}
		if (!types.size) {
			if (expand) {
				log.warn('creatio.dataservice.read.order_ignored', { entity: query.entity });
			}
			return { query };
		}
		const lookups = new Set(
			[...types]
				.filter(([, type]) => toParameterDataValueType(type) === DataValueType.Lookup)
				.map(([name]) => name),
		);
		if (!expand) {
			return { query, lookups };
		}
		// Content columns (a file's `Data`, …) are never selected: they can be megabytes per row.
		const columns = [...types]
			.filter(([, type]) => toParameterDataValueType(type) !== DataValueType.Binary)
			.map(([name]) => name);
		return { query: { ...query, columns }, lookups };
	}

	/** Keep only the requested columns (DataService auto-adds primary display/image columns
	 *  like `Photo`); in all-columns mode return rows untouched. */
	private _project(rows: any[], columns: string[] | undefined): any[] {
		if (!columns || columns.length === 0) {
			return rows;
		}
		return rows.map((row) => {
			const out: Record<string, unknown> = {};
			for (const col of columns) {
				if (row && Object.prototype.hasOwnProperty.call(row, col)) {
					out[col] = row[col];
				}
			}
			return out;
		});
	}

	/** Visible for tests: build (don't send) the SelectQuery payload. */
	public buildSelectQuery(query: ReadQuery): DataServiceSelectQuery {
		return this._queryBuilder.buildSelectQuery(query);
	}

	public listEntitySets(): Promise<string[]> {
		return this._schema.listEntitySets();
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._schema.describeEntity(assertEntityName(entitySet));
	}

	public async read(query: ReadQuery): Promise<ReadResult> {
		assertEntityName(query.entity);
		const resolved = await this._resolveRead(query);
		const opts = resolved.lookups ? { lookups: resolved.lookups } : {};
		// top:0 means "no rows" (typically a count-only request). DataService cannot FETCH 0
		// rows, so skip the row query entirely and return an empty set.
		let items: unknown[] = [];
		if (query.top !== 0) {
			const select = this._queryBuilder.buildSelectQuery(resolved.query, opts);
			const body = await this._transport.post('SelectQuery', select, {
				logContext: { entity: query.entity, top: query.top, skip: query.skip },
			});
			// DataService drops an unknown column from the result instead of failing; surface it, as
			// OData does, rather than return rows silently missing the requested column.
			if (body?.notFoundColumns?.length) {
				throw new UnknownNameError('column', String(body.notFoundColumns[0]), query.entity);
			}
			const clock = hasTemporalColumn(body?.rowConfig)
				? await this._clock.current()
				: undefined;
			items = this._project(
				normalizeDataServiceRows(this._rows(body), body?.rowConfig, clock),
				query.columns,
			);
		}
		if (!query.count) {
			return { items };
		}
		const countBody = await this._transport.post(
			'SelectQuery',
			this._queryBuilder.buildCountQuery(resolved.query, opts),
			{ logContext: { entity: query.entity, count: true } },
		);
		const totalCount = this._extractCount(countBody);
		return totalCount !== undefined ? { items, totalCount } : { items };
	}

	public async create({ entity, data }: CrudWriteParams): Promise<any> {
		assertEntityName(entity);
		const columnValues = await this._columnValues(entity, data ?? {});
		const body = await this._transport.post(
			'InsertQuery',
			{ rootSchemaName: entity, operationType: QueryOperationType.Insert, columnValues },
			{ logContext: { entity }, checkSuccess: true },
		);
		return { id: body?.id, success: body?.success !== false, rowsAffected: body?.rowsAffected };
	}

	public async update({ entity, id, data }: CrudUpdateParams): Promise<any> {
		assertEntityName(entity);
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

	public toUnknownNameError(err: unknown, { entity }: { entity: string }) {
		return toUnknownNameError(err, entity);
	}

	public async delete({ entity, id }: CrudDeleteParams): Promise<any> {
		assertEntityName(entity);
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
