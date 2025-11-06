import { XMLParser } from 'fast-xml-parser';

import log from '../../log';
import { JSON_ACCEPT, XML_ACCEPT } from '../../types';
import { CreatioAuthManager, ICreatioAuthProvider } from '../auth';
import {} from '../auth';
import { CreatioClient } from '../client';
import { CreatioClientConfig } from '../client-config';

export class ODataCreatioClient implements CreatioClient {
	private readonly _authManager: CreatioAuthManager;
	private _metadataParsed?: any;
	private _metadataXml: string | undefined;

	public get authProvider(): ICreatioAuthProvider {
		return this._authManager.getProvider();
	}

	constructor(private readonly _config: CreatioClientConfig) {
		this._authManager = new CreatioAuthManager(this._config);
	}

	private _getNormalizedBaseUrl(): string {
		return this._config.baseUrl.replace(/\/$/, '');
	}

	private _getODataRoot(): string {
		return `${this._getNormalizedBaseUrl()}/0/odata`;
	}

	private _getUserInfoServiceUrl(): string {
		return `${this._getNormalizedBaseUrl()}/0/ServiceModel/UserInfoService.svc/GetCurrentUserInfo`;
	}

	private _getProcessServiceUrl(): string {
		return `${this._getNormalizedBaseUrl()}/0/ServiceModel/ProcessEngineService.svc/RunProcess`;
	}

	private _buildEntityUrl(entity: string): string {
		return `${this._getODataRoot()}/${entity}`;
	}

	private _buildQueryString(params: string[]): string {
		return params.length ? `?${params.join('&')}` : '';
	}

	private _arrayify<T>(value: T | T[] | undefined | null): T[] {
		if (value == null) {
			return [];
		}
		return Array.isArray(value) ? value : [value];
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

	private _extractODataValue(body: any): any {
		return body && typeof body === 'object' && 'value' in body ? body.value : body;
	}

	private _createProcessParameterValues(parameters?: Record<string, any>): Array<{
		name: string;
		value: any;
	}> {
		const parameterValues: Array<{
			name: string;
			value: any;
		}> = [];
		if (!parameters) {
			return parameterValues;
		}
		Object.entries(parameters).forEach(([name, value]) => {
			let encodedValue = value;
			if (value instanceof Date) {
				encodedValue = value.toISOString();
			}
			parameterValues.push({
				name: name,
				value: encodedValue,
			});
		});
		return parameterValues;
	}

	private async _fetchJson(url: string, initFactory: () => Promise<RequestInit>) {
		const response = await this._fetchWithAuth(url, initFactory);
		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`odata_error:${response.status} ${errorText}`);
		}
		return response.json();
	}

	private async _fetchText(url: string, initFactory: () => Promise<RequestInit>) {
		const response = await this._fetchWithAuth(url, initFactory);
		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`odata_error:${response.status} ${errorText}`);
		}
		return response.text();
	}

	private async _fetchWithAuth(
		url: string,
		initFactory: () => Promise<RequestInit>,
	): Promise<Response> {
		let hasTriedRefresh = false;
		while (true) {
			const requestInit = await initFactory();
			this._logRequest(url, requestInit);
			const response = await fetch(url, requestInit);
			if (response.status !== 401) {
				return response;
			}
			this._logUnauthorizedResponse(url, response, hasTriedRefresh);
			if (hasTriedRefresh) {
				return response;
			}
			hasTriedRefresh = true;
			await this.authProvider.refresh();
		}
	}

	private async _getJsonHeaders(): Promise<Record<string, string>> {
		return this.authProvider.getHeaders(JSON_ACCEPT, true);
	}

	private async _getXmlHeaders(): Promise<Record<string, string>> {
		return this.authProvider.getHeaders(XML_ACCEPT, false);
	}

	private async _getPostHeaders(): Promise<Record<string, string>> {
		const headers = await this._getJsonHeaders();
		return {
			...headers,
			'Content-Type': 'application/json',
		};
	}

	private async _createPostRequest(body?: any): Promise<RequestInit> {
		const headers = await this._getPostHeaders();
		return {
			method: 'POST',
			headers,
			body: body ? JSON.stringify(body) : JSON.stringify({}),
		};
	}

	private _logRequest(url: string, requestInit: RequestInit): void {
		log.info('odata.request', {
			url,
			method: requestInit.method || 'GET',
			hasAuth: Boolean(requestInit.headers && (requestInit.headers as any)['Authorization']),
		});
	}

	private _logUnauthorizedResponse(
		url: string,
		response: Response,
		hasTriedRefresh: boolean,
	): void {
		log.warn('odata.401_response', {
			url,
			status: response.status,
			triedRefresh: hasTriedRefresh,
			responseHeaders: Object.fromEntries(response.headers.entries()),
		});
	}

	private _logSuccess(
		operation: string,
		status: number,
		duration: number,
		logContext: Record<string, any> = {},
	): void {
		log.info(`odata.${operation}.success`, {
			...logContext,
			status,
			duration,
		});
	}

	private async _getMetadataXml(): Promise<string> {
		if (this._metadataXml) {
			return this._metadataXml;
		}
		const headers = await this._getXmlHeaders();
		const metadataUrl = `${this._getODataRoot()}/$metadata`;
		const xmlContent = await this._fetchText(metadataUrl, async () => ({ headers }));
		this._metadataXml = xmlContent;
		return this._metadataXml;
	}

	private async _getParsedMetadata(): Promise<any> {
		if (this._metadataParsed) {
			return this._metadataParsed;
		}
		const xmlContent = await this._getMetadataXml();
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
		});
		this._metadataParsed = parser.parse(xmlContent);
		return this._metadataParsed;
	}

	private _extractSchemas(metadata: any): any[] {
		const dataServices = metadata['edmx:Edmx']?.['edmx:DataServices'];
		return this._arrayify<any>(dataServices?.Schema);
	}

	private async _executeWithTiming<T>(
		operation: string,
		url: string,
		request: () => Promise<Response>,
		successHandler: (response: Response, duration: number) => Promise<T>,
		errorHandler: (response: Response, duration: number) => Promise<never>,
		logContext: Record<string, any> = {},
	): Promise<T> {
		const startTime = Date.now();
		try {
			const response = await request();
			const duration = Date.now() - startTime;
			if (!response.ok) {
				return await errorHandler(response, duration);
			}
			return await successHandler(response, duration);
		} catch (error: any) {
			const duration = Date.now() - startTime;
			log.error(`odata.${operation}.error`, {
				...logContext,
				url,
				error: String(error?.message ?? error),
				duration,
			});
			throw error;
		}
	}

	private async _handleErrorResponse(
		operation: string,
		response: Response,
		duration: number,
		errorPrefix: string,
		logContext: Record<string, any> = {},
	): Promise<never> {
		const errorText = await response.text().catch(() => '');
		log.error(`odata.${operation}.error`, {
			...logContext,
			status: response.status,
			error: errorText,
			duration,
		});
		throw new Error(`${errorPrefix}:${response.status} ${errorText}`);
	}

	private async _tryGetEntitySetsFromService(): Promise<string[] | null> {
		try {
			const serviceUrl = `${this._getODataRoot()}/`;
			const headers = await this._getJsonHeaders();
			const response = await this._fetchWithAuth(serviceUrl, async () => ({ headers }));
			if (response.ok) {
				const body: any = await response.json().catch(() => null);
				if (body && Array.isArray(body.value)) {
					return body.value.map((item: any) => String(item.name));
				}
			}
			if (!response.ok) {
				log.error('odata.list-entity-sets.error', {
					url: serviceUrl,
					status: response.status,
				});
			}
		} catch (error: any) {
			log.error('odata.list-entity-sets.error', {
				url: `${this._getODataRoot()}/`,
				error: String(error?.message ?? error),
			});
		}
		return null;
	}

	private async _getEntitySetsFromMetadata(): Promise<string[]> {
		const metadata = await this._getParsedMetadata();
		const schemas = this._extractSchemas(metadata);
		const entitySets: string[] = [];
		for (const schema of schemas) {
			const containers = this._arrayify<any>(schema.EntityContainer);
			for (const container of containers) {
				const sets = this._arrayify<any>(container.EntitySet);
				for (const set of sets) {
					const name = set?.['@_Name'];
					if (name) {
						entitySets.push(String(name));
					}
				}
			}
		}
		return Array.from(new Set(entitySets));
	}

	private _findEntityType(schemas: any[], entitySet: string): string {
		for (const schema of schemas) {
			const containers = this._arrayify<any>(schema.EntityContainer);
			for (const container of containers) {
				const sets = this._arrayify<any>(container.EntitySet);
				for (const set of sets) {
					if (set?.['@_Name'] === entitySet) {
						return String(set?.['@_EntityType'] ?? '');
					}
				}
			}
		}
		return '';
	}

	private _findEntityTypeNode(schemas: any[], typeName: string): any {
		for (const schema of schemas) {
			const types = this._arrayify<any>(schema.EntityType);
			for (const type of types) {
				if (type?.['@_Name'] === typeName) {
					return type;
				}
			}
		}
		return undefined;
	}

	private _parseEntityProperties(entityTypeNode: any): {
		key: string[];
		properties: Array<{
			name: string;
			type: string;
			nullable?: boolean;
		}>;
	} {
		const keyRefs = this._arrayify<any>(entityTypeNode.Key?.PropertyRef);
		const key = keyRefs.map((ref) => String(ref?.['@_Name'] ?? '')).filter(Boolean) as string[];
		const propertyNodes = this._arrayify<any>(entityTypeNode.Property);
		const properties = propertyNodes.map((prop) => {
			const name = String(prop?.['@_Name'] ?? '');
			const type = String(prop?.['@_Type'] ?? '');
			const result: {
				name: string;
				type: string;
				nullable?: boolean;
			} = { name, type };
			if (Object.prototype.hasOwnProperty.call(prop, '@_Nullable')) {
				result.nullable = String(prop['@_Nullable']) === 'true';
			}
			return result;
		});
		return { key, properties };
	}

	public async getCurrentUserInfo() {
		const url = this._getUserInfoServiceUrl();
		return this._executeWithTiming(
			'getCurrentUserInfo',
			url,
			async () => {
				const requestInit = await this._createPostRequest();
				return this._fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._logSuccess('getCurrentUserInfo', response.status, duration);
				return response.json().catch(() => ({}));
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'getCurrentUserInfo',
					response,
					duration,
					'odata_get_current_user_info_failed',
					{},
				);
			},
		);
	}

	public async create(entity: string, data: any) {
		const url = this._buildEntityUrl(entity);
		return this._executeWithTiming(
			'create',
			url,
			async () => {
				const headers = await this._getJsonHeaders();
				return this._fetchWithAuth(url, async () => ({
					method: 'POST',
					headers,
					body: JSON.stringify(data),
				}));
			},
			async (response, duration) => {
				this._logSuccess('create', response.status, duration, { entity });
				return response.json().catch(() => ({}));
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'create',
					response,
					duration,
					'odata_create_failed',
					{
						entity,
						url,
					},
				);
			},
			{ entity },
		);
	}

	public async read(
		entity: string,
		filter?: string,
		select?: string[],
		top?: number,
		expand?: string[],
		orderBy?: string,
	) {
		const startTime = Date.now();
		const queryParams = this._buildODataQueryParams(filter, select, top, expand, orderBy);
		const url = this._buildEntityUrl(entity) + this._buildQueryString(queryParams);
		const headers = await this._getJsonHeaders();
		try {
			const body = await this._fetchJson(url, async () => ({ headers }));
			const result = this._extractODataValue(body);
			const duration = Date.now() - startTime;
			const resultCount = Array.isArray(result) ? result.length : result ? 1 : 0;
			log.info('odata.read.success', {
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
			log.error('odata.read.error', {
				entity,
				url,
				error: String(error?.message ?? error),
				duration,
			});
			throw error;
		}
	}

	public async update(entity: string, id: string, data: any) {
		const url = `${this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._executeWithTiming(
			'update',
			url,
			async () => {
				const headers = await this._getJsonHeaders();
				return this._fetchWithAuth(url, async () => ({
					method: 'PATCH',
					headers,
					body: JSON.stringify(data),
				}));
			},
			async (response, duration) => {
				this._logSuccess('update', response.status, duration, { entity, id });
				return response.text();
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'update',
					response,
					duration,
					'odata_update_failed',
					{
						entity,
						id,
						url,
					},
				);
			},
			{ entity, id },
		);
	}

	public async delete(entity: string, id: string) {
		const url = `${this._buildEntityUrl(entity)}(${this._formatEntityKey(id)})`;
		return this._executeWithTiming(
			'delete',
			url,
			async () => {
				const headers = await this._getJsonHeaders();
				return this._fetchWithAuth(url, async () => ({ method: 'DELETE', headers }));
			},
			async (response, duration) => {
				this._logSuccess('delete', response.status, duration, { entity, id });
				return response.text();
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'delete',
					response,
					duration,
					'odata_delete_failed',
					{
						entity,
						id,
						url,
					},
				);
			},
			{ entity, id },
		);
	}

	public async listEntitySets(): Promise<string[]> {
		const serviceSets = await this._tryGetEntitySetsFromService();
		if (serviceSets) {
			return serviceSets;
		}
		return this._getEntitySetsFromMetadata();
	}

	public async describeEntity(entitySet: string): Promise<{
		entitySet: string;
		entityType: string;
		key: string[];
		properties: Array<{
			name: string;
			type: string;
			nullable?: boolean;
		}>;
	}> {
		const metadata = await this._getParsedMetadata();
		const schemas = this._extractSchemas(metadata);
		const fullType = this._findEntityType(schemas, entitySet);
		if (!fullType) {
			const error = `entity_not_found:${entitySet}`;
			log.error('odata.describe-entity.error', { entitySet, error });
			throw new Error(error);
		}
		const typeName = fullType.split('.').pop()!;
		const entityTypeNode = this._findEntityTypeNode(schemas, typeName);
		if (!entityTypeNode) {
			const error = `entity_type_not_found:${typeName}`;
			log.error('odata.describe-entity.error', { entitySet, error });
			throw new Error(error);
		}
		const { key, properties } = this._parseEntityProperties(entityTypeNode);
		return { entitySet, entityType: typeName, key, properties };
	}

	public async executeProcess(
		processName: string,
		parameters?: Record<string, any>,
	): Promise<any> {
		const url = this._getProcessServiceUrl();
		return this._executeWithTiming(
			'execute-process',
			url,
			async () => {
				const body = {
					schemaName: processName,
					parameterValues: this._createProcessParameterValues(parameters),
					resultParameterNames: [],
				};
				const requestInit = await this._createPostRequest(body);
				return this._fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._logSuccess('execute-process', response.status, duration, { processName });
				return response.json();
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'execute-process',
					response,
					duration,
					'odata_execute_process_failed',
					{
						processName,
						url,
					},
				);
			},
			{ processName },
		);
	}

	public async setSysSettingsValues(sysSettingsValues: Record<string, any>): Promise<any> {
		const url = `${this._getNormalizedBaseUrl()}/DataService/json/SyncReply/PostSysSettingsValues`;
		return this._executeWithTiming(
			'set-sys-settings-value',
			url,
			async () => {
				const body = {
					isPersonal: false,
					sysSettingsValues,
				};
				const requestInit = await this._createPostRequest(body);
				return this._fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._logSuccess('set-sys-settings-value', response.status, duration, {
					settingsCount: Object.keys(sysSettingsValues).length,
				});
				return response.text();
			},
			async (response, duration) => {
				return this._handleErrorResponse(
					'set-sys-settings-value',
					response,
					duration,
					'set_sys_settings_value_failed',
					{
						settingsCount: Object.keys(sysSettingsValues).length,
						url,
					},
				);
			},
			{ settingsCount: Object.keys(sysSettingsValues).length },
		);
	}
}
