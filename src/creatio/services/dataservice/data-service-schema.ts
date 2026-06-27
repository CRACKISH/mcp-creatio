import { EntitySchemaDescription } from '../../contracts';

import { DataServiceFilterTranslator } from './data-service-filter-translator';
import { DataServiceQueryBuilder } from './data-service-query-builder';
import { DataServiceSelectQuery, DataValueType } from './data-service-types';
import { DataServiceTransport } from './data-service-transport';

interface RuntimeColumn {
	uId?: string;
	name: string;
	dataValueType: DataValueType;
	isRequired?: boolean;
	referenceSchemaName?: string;
}

interface RuntimeSchema {
	name: string;
	primaryColumnUId?: string;
	columns?: { Items?: Record<string, RuntimeColumn> };
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const ENTITY_LIST_SCHEMA = 'VwSysSchemaInWorkspace';
const ENTITY_MANAGER = 'EntitySchemaManager';

/**
 * DataService-native schema discovery, on the SAME transport as CRUD (so the backend needs
 * no OData at all):
 * - `describeEntity` / column-type maps come from `RuntimeEntitySchemaRequest`, which returns
 *   each column's native `dataValueType` + `referenceSchemaName` — the authoritative source
 *   for write coercion (the platform never infers the type from the JSON value).
 * - `listEntitySets` runs `SELECT DISTINCT Name, Caption FROM VwSysSchemaInWorkspace WHERE
 *   ManagerName = 'EntitySchemaManager' ORDER BY Name` as a SelectQuery.
 * Runtime schemas are cached per entity (TTL) so describe + coercion share one fetch.
 */
export class DataServiceSchemaProvider {
	private readonly _transport: DataServiceTransport;
	private readonly _queryBuilder: DataServiceQueryBuilder;
	private readonly _filters: DataServiceFilterTranslator;
	private readonly _schemaCache = new Map<string, { schema: RuntimeSchema; at: number }>();

	constructor(
		transport: DataServiceTransport,
		queryBuilder = new DataServiceQueryBuilder(),
		filters = new DataServiceFilterTranslator(),
	) {
		this._transport = transport;
		this._queryBuilder = queryBuilder;
		this._filters = filters;
	}

	/** Build the entity-list SelectQuery (visible for tests). */
	public buildListQuery(): DataServiceSelectQuery {
		const query = this._queryBuilder.buildSelectQuery({
			entity: ENTITY_LIST_SCHEMA,
			columns: ['Name', 'Caption'],
			order: [{ field: 'Name', dir: 'asc' }],
			filter: { kind: 'condition', field: 'ManagerName', op: 'eq', value: ENTITY_MANAGER },
		});
		query.isDistinct = true;
		return query;
	}

	public async listEntitySets(): Promise<string[]> {
		const body = await this._transport.post('SelectQuery', this.buildListQuery(), {
			logContext: { entity: ENTITY_LIST_SCHEMA },
		});
		const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
		return rows.map((r) => String(r?.Name)).filter((name) => name && name !== 'undefined');
	}

	private async _getRuntimeSchema(name: string): Promise<RuntimeSchema> {
		const cached = this._schemaCache.get(name);
		if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
			return cached.schema;
		}
		const body = await this._transport.post(
			'RuntimeEntitySchemaRequest',
			{ name },
			{ logContext: { entity: name }, checkSuccess: true },
		);
		const schema: RuntimeSchema | undefined = body?.schema;
		if (!schema || !schema.name) {
			throw new Error(`entity_not_found:${name}`);
		}
		this._schemaCache.set(name, { schema, at: Date.now() });
		return schema;
	}

	private _columns(schema: RuntimeSchema): RuntimeColumn[] {
		return Object.values(schema.columns?.Items ?? {});
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		const schema = await this._getRuntimeSchema(entitySet);
		const columns = this._columns(schema);
		const primary = columns.find((c) => c.uId && c.uId === schema.primaryColumnUId);
		return {
			entitySet,
			entityType: schema.name,
			key: primary ? [primary.name] : ['Id'],
			properties: columns.map((c) => ({
				name: c.name,
				type: DataValueType[c.dataValueType] ?? String(c.dataValueType),
				nullable: !c.isRequired,
			})),
		};
	}

	/** Map of column name -> native {@link DataValueType} for write coercion. Empty on miss. */
	public async columnTypes(entity: string): Promise<Map<string, DataValueType>> {
		try {
			const schema = await this._getRuntimeSchema(entity);
			return new Map(this._columns(schema).map((c) => [c.name, c.dataValueType]));
		} catch {
			// Coercion degrades to the per-value heuristic when the schema is unavailable.
			return new Map();
		}
	}
}
