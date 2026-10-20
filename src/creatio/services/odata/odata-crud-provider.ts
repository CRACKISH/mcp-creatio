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
} from '../../contracts';
import {
	TemporalKind,
	UserClock,
	mapTemporalFilterValues,
	temporalColumns,
	temporalFilterFields,
} from '../../temporal';
import { ColumnSchemaSource, resolveTemporalKinds } from '../column-schema-source';
import { assertEntityName } from '../entity-name';
import { CreatioHttpClient } from '../http-client';
import { GUID_RE } from '../identifiers';
import { LookupNames, needsLookupNames } from '../lookup-path';
import { UserClockSource, fixedClockSource } from '../user-time-zone';

import { ODataMetadataStore } from './metadata-store';
import { toUnknownNameError } from './odata-errors';
import { ODataQueryTranslator } from './odata-query-translator';
import { odataRoot } from './odata-routes';
import { normalizeODataValue } from './odata-value-normalizer';

/** What converts dates between the tools' contract and OData's UTC instants (see {@link UserClock}). */
export interface ODataTemporalDeps {
	/** Creatio's schema: OData's own metadata cannot tell a Date column from a DateTime one. */
	schema: ColumnSchemaSource;
	/** The calling user's zone. */
	clock?: UserClockSource;
}

type Row = Record<string, unknown>;

export class ODataCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _metadataStore: ODataMetadataStore;
	private readonly _translator: ODataQueryTranslator;
	private readonly _schema: ColumnSchemaSource | undefined;
	private readonly _clock: UserClockSource;

	public readonly kind = 'creatio-odata';
	// OData honors both read escape hatches: a raw `$filter` string and `$expand`.
	public readonly capabilities: CrudCapabilities = { rawFilter: true, expand: true };

	constructor(
		client: CreatioHttpClient,
		metadataStore: ODataMetadataStore,
		translator = new ODataQueryTranslator(),
		temporal?: ODataTemporalDeps,
	) {
		this._client = client;
		this._metadataStore = metadataStore;
		this._translator = translator;
		this._schema = temporal?.schema;
		this._clock = temporal?.clock ?? fixedClockSource();
	}

	private _buildQueryString(params: string[]): string {
		return params.length ? `?${params.join('&')}` : '';
	}

	private _extractODataValue(body: any): any {
		return body && typeof body === 'object' && 'value' in body ? body.value : body;
	}

	private async _buildEntityUrl(entity: string): Promise<string> {
		// Validate to prevent path/segment injection into the request URL (CWE-20 / CWE-943).
		const name = assertEntityName(entity);
		return `${await odataRoot(this._client.normalizedBaseUrl)}/${name}`;
	}

	/** Only a top-level `XxxId` filter needs them; a metadata failure keeps the heuristic. */
	private async _lookupNames(query: ReadQuery): Promise<LookupNames | undefined> {
		if (!needsLookupNames(query)) {
			return undefined;
		}
		try {
			return await this._metadataStore.lookupNames(query.entity);
		} catch (err) {
			log.warn('creatio.odata.lookup_names_unavailable', {
				entity: query.entity,
				error: String(err),
			});
			return undefined;
		}
	}

	/** A write body with its date/time columns as UTC instants (a zone-less value is the user's
	 *  wall clock; OData itself refuses it). Unchanged without a schema. */
	private async _toInstants(entity: string, data: Row | undefined): Promise<Row | undefined> {
		if (!data || !this._schema) {
			return data;
		}
		const kinds = temporalColumns(await this._schema.columnTypes(entity));
		const columns = Object.keys(data).filter((column) => kinds.has(column));
		if (!columns.length) {
			return data;
		}
		const clock = await this._clock.current();
		const out = { ...data };
		for (const column of columns) {
			out[column] = clock.toInstant(kinds.get(column)!, out[column]);
		}
		return out;
	}

	/**
	 * The read's date/time filter values as UTC instants, by their columns' kinds (related paths
	 * included). OData rejects a bare date (`ge 2026-11-01` 500s on both runtimes), so a value whose
	 * column kind is unknown is still sent as an instant — of the user's wall clock.
	 */
	private async _filterToInstants(query: ReadQuery): Promise<ReadQuery> {
		const fields = temporalFilterFields(query.filter);
		if (!fields.length) {
			return query;
		}
		const [kinds, clock] = await Promise.all([
			this._schema
				? resolveTemporalKinds(this._schema, query.entity, fields)
				: new Map<string, TemporalKind>(),
			this._clock.current(),
		]);
		return {
			...query,
			filter: mapTemporalFilterValues(
				query.filter!,
				kinds,
				(kind, v) => clock.toInstant(kind, v),
				() => 'datetime',
			),
		};
	}

	/**
	 * Records with their date/time values in the tools' contract — the user's wall clock labelled
	 * with the user's offset, a Date as `YYYY-MM-DD` — recursing into an `$expand`-ed lookup by the
	 * entity it references. Schema and clock are fetched once per entity / read, and only when used.
	 */
	private async _labelTemporal(entity: string, records: unknown[]): Promise<unknown[]> {
		const schema = this._schema;
		if (!schema || !records.length) {
			return records;
		}
		const shapes = new Map<
			string,
			Promise<[ReadonlyMap<string, number>, ReadonlyMap<string, string>]>
		>();
		const shapeOf = (name: string) => {
			let shape = shapes.get(name);
			if (!shape) {
				shape = Promise.all([schema.columnTypes(name), schema.references(name)]);
				shapes.set(name, shape);
			}
			return shape;
		};
		let clock: Promise<UserClock> | undefined;
		const label = async (name: string, record: unknown): Promise<unknown> => {
			if (!record || typeof record !== 'object' || Array.isArray(record)) {
				return record;
			}
			const [types, references] = await shapeOf(name);
			const kinds = temporalColumns(types);
			const out: Row = { ...(record as Row) };
			for (const [key, value] of Object.entries(out)) {
				const kind = kinds.get(key);
				const target = references.get(key);
				if (kind && value != null) {
					out[key] = (await (clock ??= this._clock.current())).fromInstant(kind, value);
				} else if (target && value && typeof value === 'object') {
					out[key] = await label(target, value);
				}
			}
			return out;
		};
		return Promise.all(records.map((record) => label(entity, record)));
	}

	private _formatEntityKey(id: string): string {
		// A numeric or GUID key is a bare literal; any other string key is quoted (quotes doubled).
		if (/^\d+$/.test(id) || GUID_RE.test(id)) {
			return id;
		}
		return `'${id.replace(/'/g, "''")}'`;
	}

	public listEntitySets(): Promise<string[]> {
		return this._metadataStore.listEntitySets();
	}

	public describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		return this._metadataStore.describeEntity(entitySet);
	}

	public async create({ entity, data }: CrudWriteParams) {
		const url = await this._buildEntityUrl(entity);
		const body = await this._toInstants(entity, data);
		const created = await this._client.request(
			'create',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'POST',
					headers,
					body: JSON.stringify(body),
				}));
			},
			async (response, duration) => {
				this._client.logSuccess('create', response.status, duration, { entity });
				return response.json().catch(() => ({}));
			},
			{ errorPrefix: 'creatio_create_failed', logContext: { entity } },
		);
		const [labelled] = await this._labelTemporal(entity, [created]);
		return labelled;
	}

	public async read(query: ReadQuery): Promise<ReadResult> {
		const { entity, count } = query;
		const queryParams = this._translator.buildQueryParams(
			await this._filterToInstants(query),
			await this._lookupNames(query),
		);
		const url = (await this._buildEntityUrl(entity)) + this._buildQueryString(queryParams);
		const result: ReadResult = await this._client.request(
			'read',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({ headers }));
			},
			async (response, duration) => {
				const body: any = await response.json().catch(() => ({}));
				const value = this._extractODataValue(body);
				const raw = Array.isArray(value) ? value : value != null ? [value] : [];
				const items = raw.map(normalizeODataValue);
				// `@odata.count` is the server-side total of all matching records (ignores $top/$skip).
				const total =
					body && typeof body === 'object' && '@odata.count' in body
						? Number((body as Record<string, unknown>)['@odata.count'])
						: undefined;
				this._client.logSuccess('read', response.status, duration, {
					entity,
					select: query.columns?.join(','),
					expand: query.odata?.expand?.join(','),
					top: query.top,
					skip: query.skip,
					count,
					resultCount: items.length,
					total,
				});
				// Surface the server-side total only when a count was requested and present.
				return count && total !== undefined ? { items, totalCount: total } : { items };
			},
			{ errorPrefix: 'creatio_read_failed', logContext: { entity } },
		);
		return { ...result, items: await this._labelTemporal(entity, result.items) };
	}

	public async update({ entity, id, data }: CrudUpdateParams) {
		const url = `${await this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		const body = await this._toInstants(entity, data);
		return this._client.request(
			'update',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'PATCH',
					headers,
					body: JSON.stringify(body),
				}));
			},
			async (response, duration) => {
				this._client.logSuccess('update', response.status, duration, { entity, id });
				return response.text();
			},
			{ errorPrefix: 'creatio_update_failed', logContext: { entity, id } },
		);
	}

	public toUnknownNameError(
		err: unknown,
		{ entity, collectionRead }: { entity: string; collectionRead: boolean },
	) {
		return toUnknownNameError(err, entity, collectionRead);
	}

	public async delete({ entity, id }: CrudDeleteParams) {
		const url = `${await this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._client.request(
			'delete',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'DELETE',
					headers,
				}));
			},
			async (response, duration) => {
				this._client.logSuccess('delete', response.status, duration, { entity, id });
				return response.text();
			},
			{ errorPrefix: 'creatio_delete_failed', logContext: { entity, id } },
		);
	}
}
