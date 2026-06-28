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
import { assertEntityName } from '../entity-name';
import { CreatioHttpClient } from '../http-client';
import { GUID_RE } from '../identifiers';

import { ODataMetadataStore } from './metadata-store';
import { ODataQueryTranslator } from './odata-query-translator';
import { odataRoot } from './odata-routes';

export class ODataCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _metadataStore: ODataMetadataStore;
	private readonly _translator: ODataQueryTranslator;

	public readonly kind = 'creatio-odata';
	// OData honors both read escape hatches: a raw `$filter` string and `$expand`.
	public readonly capabilities: CrudCapabilities = { rawFilter: true, expand: true };

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

	private _buildEntityUrl(entity: string): string {
		// Validate to prevent path/segment injection into the request URL (CWE-20 / CWE-943).
		return `${odataRoot(this._client.normalizedBaseUrl)}/${assertEntityName(entity)}`;
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
		const queryParams = this._translator.buildQueryParams(query);
		const url = this._buildEntityUrl(entity) + this._buildQueryString(queryParams);
		return this._client.request(
			'read',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({ headers }));
			},
			async (response, duration) => {
				const body: any = await response.json().catch(() => ({}));
				const value = this._extractODataValue(body);
				const items = Array.isArray(value) ? value : value != null ? [value] : [];
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
