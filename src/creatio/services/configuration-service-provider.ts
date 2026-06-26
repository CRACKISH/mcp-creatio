import {
	CallConfigurationServiceRequest,
	CallConfigurationServiceResult,
	ConfigurationProvider,
	ConfigurationServiceHttpMethod,
	ConfigurationServiceQueryValue,
} from '../providers';

import { CreatioHttpClient } from './http-client';

const VALID_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const METHODS_WITHOUT_BODY: ReadonlySet<ConfigurationServiceHttpMethod> = new Set([
	'GET',
	'DELETE',
]);

export class ConfigurationServiceProvider implements ConfigurationProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-configuration-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _validateName(kind: 'service' | 'method', value: string): void {
		if (!VALID_NAME_PATTERN.test(value)) {
			throw new Error(`creatio_configuration_invalid_${kind}_name:${value}`);
		}
	}

	private _buildQueryString(
		query: Record<string, ConfigurationServiceQueryValue> | undefined,
	): string {
		if (!query) {
			return '';
		}
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(query)) {
			params.append(key, String(value));
		}
		const serialized = params.toString();
		return serialized ? `?${serialized}` : '';
	}

	private _buildUrl(request: CallConfigurationServiceRequest): string {
		if (request.rawPath) {
			// Caller-built multi-segment path (already safely encoded). Bypass the
			// single-segment service/method validation.
			const path = request.rawPath.startsWith('/') ? request.rawPath : `/${request.rawPath}`;
			return `${this._client.normalizedBaseUrl}${path}${this._buildQueryString(request.query)}`;
		}
		this._validateName('service', request.service ?? '');
		this._validateName('method', request.method ?? '');
		const base = `${this._client.normalizedBaseUrl}/0/rest/${request.service}/${request.method}`;
		return `${base}${this._buildQueryString(request.query)}`;
	}

	private async _buildRequestInit(
		httpMethod: ConfigurationServiceHttpMethod,
		body: unknown,
	): Promise<RequestInit> {
		const includeBody = !METHODS_WITHOUT_BODY.has(httpMethod) && body !== undefined;
		const headers = includeBody
			? await this._client.getPostHeaders()
			: await this._client.getJsonHeaders();
		const init: RequestInit = { method: httpMethod, headers };
		if (includeBody) {
			init.body = JSON.stringify(body);
		}
		return init;
	}

	private async _parseResponseBody(response: Response): Promise<{
		body: unknown;
		contentType?: string;
	}> {
		const contentType = response.headers.get('content-type') ?? undefined;
		const text = await response.text();
		if (!text) {
			return contentType !== undefined ? { body: null, contentType } : { body: null };
		}
		if (contentType && contentType.toLowerCase().includes('application/json')) {
			try {
				return { body: JSON.parse(text), contentType };
			} catch {
				return { body: text, contentType };
			}
		}
		return contentType !== undefined ? { body: text, contentType } : { body: text };
	}

	public async call(
		request: CallConfigurationServiceRequest,
	): Promise<CallConfigurationServiceResult> {
		const httpMethod: ConfigurationServiceHttpMethod = request.httpMethod ?? 'POST';
		const url = this._buildUrl(request);
		const operation = request.rawPath
			? `call-configuration-service:${request.rawPath}`
			: `call-configuration-service:${request.service}.${request.method}`;
		return this._client.executeWithTiming(
			operation,
			url,
			async () => {
				const init = await this._buildRequestInit(httpMethod, request.body);
				return this._client.fetchWithAuth(url, async () => init);
			},
			async (response, duration) => {
				const { body, contentType } = await this._parseResponseBody(response);
				this._client.logSuccess(operation, response.status, duration, {
					httpMethod,
					service: request.service,
					method: request.method,
				});
				const result: CallConfigurationServiceResult = {
					status: response.status,
					body,
				};
				if (contentType !== undefined) {
					result.contentType = contentType;
				}
				return result;
			},
			async (response, duration) =>
				this._client.handleErrorResponse(
					operation,
					response,
					duration,
					'creatio_configuration_service_failed',
					{ url, httpMethod },
				),
			{ httpMethod, service: request.service, method: request.method },
		);
	}
}
