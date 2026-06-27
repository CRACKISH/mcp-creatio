export type ConfigurationServiceHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type ConfigurationServiceQueryValue = string | number | boolean;

export interface CallConfigurationServiceRequest {
	service?: string;
	method?: string;
	// Pre-built relative path under the base URL (e.g. "/0/rest/ToolServiceMcp/{code}/v1/mcp").
	// Takes precedence over service/method and bypasses the single-segment name validation —
	// the caller is responsible for safely encoding any dynamic path segments. Used for
	// multi-segment routes that `service`/`method` cannot express.
	rawPath?: string;
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
