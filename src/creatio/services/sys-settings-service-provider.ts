import { randomUUID } from 'node:crypto';

import {
	CreateSysSettingRequest,
	CreateSysSettingResult,
	QuerySysSettingsResponse,
	SysSettingDefinition,
	SysSettingInsertResponse,
	SysSettingsProvider,
} from '../providers';

import { CreatioHttpClient } from './http-client';

export class SysSettingsServiceProvider implements SysSettingsProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-sys-settings-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _getSetValuesUrl(): string {
		return `${this._client.normalizedBaseUrl}/DataService/json/SyncReply/PostSysSettingsValues`;
	}

	private _getQueryUrl(): string {
		return `${this._client.normalizedBaseUrl}/DataService/json/SyncReply/QuerySysSettings`;
	}

	private _getInsertUrl(): string {
		return `${this._client.normalizedBaseUrl}/DataService/json/SyncReply/InsertSysSettingRequest`;
	}

	private async _insertSetting(
		definition: SysSettingDefinition,
	): Promise<SysSettingInsertResponse> {
		const payload = {
			id: definition.id ?? randomUUID(),
			...definition,
		};
		const url = this._getInsertUrl();
		return this._client.executeWithTiming(
			'insert-sys-setting',
			url,
			async () => {
				const requestInit = await this._client.createPostRequest(payload);
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				const body = (await response.json()) as SysSettingInsertResponse;
				this._client.logSuccess('insert-sys-setting', response.status, duration, {
					code: payload.code,
				});
				return body;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					'insert-sys-setting',
					response,
					duration,
					'creatio_insert_sys_setting_failed',
					{
						code: payload.code,
						url,
					},
				),
			{ code: payload.code },
		);
	}

	public async setValues(sysSettingsValues: Record<string, any>): Promise<any> {
		const url = this._getSetValuesUrl();
		return this._client.executeWithTiming(
			'set-sys-settings-value',
			url,
			async () => {
				const body = {
					isPersonal: false,
					sysSettingsValues,
				};
				const requestInit = await this._client.createPostRequest(body);
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._client.logSuccess('set-sys-settings-value', response.status, duration, {
					settingsCount: Object.keys(sysSettingsValues).length,
				});
				return response.text();
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					'set-sys-settings-value',
					response,
					duration,
					'creatio_set_sys_settings_value_failed',
					{
						settingsCount: Object.keys(sysSettingsValues).length,
						url,
					},
				),
			{ settingsCount: Object.keys(sysSettingsValues).length },
		);
	}

	public async queryValues(sysSettingCodes: string[]): Promise<QuerySysSettingsResponse> {
		if (!sysSettingCodes || sysSettingCodes.length === 0) {
			return { success: true, values: {} };
		}
		const url = this._getQueryUrl();
		return this._client.executeWithTiming(
			'query-sys-settings',
			url,
			async () => {
				const body = {
					sysSettingsNameCollection: sysSettingCodes,
				};
				const requestInit = await this._client.createPostRequest(body);
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				const payload = (await response.json()) as QuerySysSettingsResponse;
				this._client.logSuccess('query-sys-settings', response.status, duration, {
					settingsCount: sysSettingCodes.length,
				});
				return payload;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					'query-sys-settings',
					response,
					duration,
					'creatio_query_sys_settings_failed',
					{
						settingsCount: sysSettingCodes.length,
						url,
					},
				),
			{ settingsCount: sysSettingCodes.length },
		);
	}

	public async createSetting({
		definition,
		initialValue,
	}: CreateSysSettingRequest): Promise<CreateSysSettingResult> {
		const insertResult = await this._insertSetting(definition);
		let setValueResult: any;
		if (initialValue !== undefined) {
			setValueResult = await this.setValues({ [definition.code]: initialValue });
		}
		return { insertResult, setValueResult };
	}
}
