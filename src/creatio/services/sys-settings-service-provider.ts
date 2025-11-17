import { SysSettingsProvider } from '../providers';

import { CreatioHttpClient } from './http-client';

export class SysSettingsServiceProvider implements SysSettingsProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-sys-settings-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	public async setValues(sysSettingsValues: Record<string, any>): Promise<any> {
		const url = this._client.getSysSettingsServiceUrl();
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
}
