import log from '../../log';
import {
	CrudDeleteParams,
	CrudProvider,
	CrudReadParams,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
} from '../providers';

import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './metadata-store';

export class ODataCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _metadataStore: ODataMetadataStore;

	public readonly kind = 'creatio-odata';

	constructor(client: CreatioHttpClient, metadataStore: ODataMetadataStore) {
		this._client = client;
		this._metadataStore = metadataStore;
	}

	private _buildODataQueryParams(
		filter?: string,
		select?: string[],
		top?: number,
		expand?: string[],
		orderBy?: string,
	): string[] {
		const params: string[] = [];
		if (filter) {
			params.push(`$filter=${encodeURIComponent(filter)}`);
		}
		if (select && select.length > 0) {
			params.push(`$select=${encodeURIComponent(select.join(','))}`);
		}
		if (expand && expand.length > 0) {
			params.push(`$expand=${encodeURIComponent(expand.join(','))}`);
		}
		if (orderBy) {
			params.push(`$orderby=${encodeURIComponent(orderBy)}`);
		}
		if (top) {
			params.push(`$top=${top}`);
		}
		return params;
	}

	private _buildQueryString(params: string[]): string {
		return params.length ? `?${params.join('&')}` : '';
	}

	private _extractODataValue(body: any): any {
		return body && typeof body === 'object' && 'value' in body ? body.value : body;
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
		const url = this._client.buildEntityUrl(entity);
		return this._client.executeWithTiming(
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
			async (response, duration) =>
				this._client.handleErrorResponse(
					'create',
					response,
					duration,
					'creatio_create_failed',
					{
						entity,
						url,
					},
				),
			{ entity },
		);
	}

	public async read({ entity, filter, select, top, expand, orderBy }: CrudReadParams) {
		const startTime = Date.now();
		const queryParams = this._buildODataQueryParams(filter, select, top, expand, orderBy);
		const url = this._client.buildEntityUrl(entity) + this._buildQueryString(queryParams);
		const headers = await this._client.getJsonHeaders();
		try {
			const body = await this._client.fetchJson(url, async () => ({ headers }));
			const result = this._extractODataValue(body);
			const duration = Date.now() - startTime;
			const resultCount = Array.isArray(result) ? result.length : result ? 1 : 0;
			log.info('creatio.crud.read.success', {
				entity,
				filter,
				select: select?.join(','),
				expand: expand?.join(','),
				orderBy,
				top,
				resultCount,
				duration,
			});
			return result;
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
		const url = `${this._client.buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._client.executeWithTiming(
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
			async (response, duration) =>
				this._client.handleErrorResponse(
					'update',
					response,
					duration,
					'creatio_update_failed',
					{
						entity,
						id,
						url,
					},
				),
			{ entity, id },
		);
	}

	public async delete({ entity, id }: CrudDeleteParams) {
		const url = `${this._client.buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._client.executeWithTiming(
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
			async (response, duration) =>
				this._client.handleErrorResponse(
					'delete',
					response,
					duration,
					'creatio_delete_failed',
					{
						entity,
						id,
						url,
					},
				),
			{ entity, id },
		);
	}
}
