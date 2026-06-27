import log from '../../log';
import {
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
} from '../contracts';

import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './metadata-store';
import { ODataQueryTranslator } from './odata-query-translator';

export class ODataCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _metadataStore: ODataMetadataStore;
	private readonly _translator: ODataQueryTranslator;

	public readonly kind = 'creatio-odata';

	constructor(
		client: CreatioHttpClient,
		metadataStore: ODataMetadataStore,
		translator = new ODataQueryTranslator(),
	) {
		this._client = client;
		this._metadataStore = metadataStore;
		this._translator = translator;
	}

	private _buildQueryString(params: string[]): string {
		return params.length ? `?${params.join('&')}` : '';
	}

	private _extractODataValue(body: any): any {
		return body && typeof body === 'object' && 'value' in body ? body.value : body;
	}

	private static readonly ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

	private _validateEntityName(entity: string): string {
		// OData entity-set names are simple identifiers. Reject anything else to prevent
		// path/segment injection into the request URL (CWE-20 / CWE-943).
		if (!entity || !ODataCrudProvider.ENTITY_NAME_PATTERN.test(entity)) {
			throw new Error(`invalid_entity_name:${entity}`);
		}
		return entity;
	}

	private _buildEntityUrl(entity: string): string {
		return `${this._client.odataRoot}/${this._validateEntityName(entity)}`;
	}

	private _formatEntityKey(id: string): string {
		const GUID_PATTERN =
			/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
		const NUMERIC_PATTERN = /^\d+$/;
		if (NUMERIC_PATTERN.test(id) || GUID_PATTERN.test(id)) {
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
		const url = this._buildEntityUrl(entity);
		return this._client.request(
			'create',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'POST',
					headers,
					body: JSON.stringify(data),
				}));
			},
			async (response, duration) => {
				this._client.logSuccess('create', response.status, duration, { entity });
				return response.json().catch(() => ({}));
			},
			{ errorPrefix: 'creatio_create_failed', logContext: { entity } },
		);
	}

	public async read(query: ReadQuery): Promise<ReadResult> {
		const { entity, count } = query;
		const startTime = Date.now();
		const queryParams = this._translator.buildQueryParams(query);
		const url = this._buildEntityUrl(entity) + this._buildQueryString(queryParams);
		const headers = await this._client.getJsonHeaders();
		try {
			const body = await this._client.fetchJson(url, async () => ({ headers }));
			const value = this._extractODataValue(body);
			const items = Array.isArray(value) ? value : value != null ? [value] : [];
			const duration = Date.now() - startTime;
			// `@odata.count` is the server-side total of all matching records (ignores $top/$skip).
			const total =
				body && typeof body === 'object' && '@odata.count' in body
					? Number((body as Record<string, unknown>)['@odata.count'])
					: undefined;
			log.info('creatio.crud.read.success', {
				entity,
				select: query.columns?.join(','),
				expand: query.odata?.expand?.join(','),
				top: query.top,
				skip: query.skip,
				count,
				resultCount: items.length,
				total,
				duration,
			});
			// Surface the server-side total only when a count was requested and present.
			return count && total !== undefined ? { items, totalCount: total } : { items };
		} catch (error: any) {
			const duration = Date.now() - startTime;
			log.error('creatio.crud.read.error', {
				entity,
				url,
				error: String(error?.message ?? error),
				duration,
			});
			throw error;
		}
	}

	public async update({ entity, id, data }: CrudUpdateParams) {
		const url = `${this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._client.request(
			'update',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'PATCH',
					headers,
					body: JSON.stringify(data),
				}));
			},
			async (response, duration) => {
				this._client.logSuccess('update', response.status, duration, { entity, id });
				return response.text();
			},
			{ errorPrefix: 'creatio_update_failed', logContext: { entity, id } },
		);
	}

	public async delete({ entity, id }: CrudDeleteParams) {
		const url = `${this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
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
