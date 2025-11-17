import { ExecuteProcessParams, ExecuteProcessResult, ProcessProvider } from '../providers';

import { CreatioHttpClient } from './http-client';

export class ProcessServiceProvider implements ProcessProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-process-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _getServiceUrl(): string {
		return `${this._client.normalizedBaseUrl}/0/ServiceModel/ProcessEngineService.svc/RunProcess`;
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
				name,
				value: encodedValue,
			});
		});
		return parameterValues;
	}

	public async executeProcess({ processName, parameters }: ExecuteProcessParams) {
		const url = this._getServiceUrl();
		return this._client.executeWithTiming(
			'execute-process',
			url,
			async () => {
				const body = {
					schemaName: processName,
					parameterValues: this._createProcessParameterValues(parameters),
					resultParameterNames: [],
				};
				const requestInit = await this._client.createPostRequest(body);
				return this._client.fetchWithAuth(url, async () => requestInit);
			},
			async (response, duration) => {
				this._client.logSuccess('execute-process', response.status, duration, {
					processName,
				});
				return (await response.json()) as ExecuteProcessResult;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					'execute-process',
					response,
					duration,
					'creatio_execute_process_failed',
					{
						processName,
						url,
					},
				),
			{ processName },
		);
	}
}
