export type ConfigurationServiceHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type ConfigurationServiceQueryValue = string | number | boolean;

export interface CallConfigurationServiceRequest {
	service: string;
	method: string;
	httpMethod?: ConfigurationServiceHttpMethod;
	body?: unknown;
	query?: Record<string, ConfigurationServiceQueryValue>;
}

export interface CallConfigurationServiceResult {
	status: number;
	contentType?: string;
	body: unknown;
}

export interface ConfigurationProvider {
	readonly kind: string;
	call(request: CallConfigurationServiceRequest): Promise<CallConfigurationServiceResult>;
}
