import log from '../../log';
import { JSON_ACCEPT, XML_ACCEPT } from '../../types';
import { CreatioAuthManager, ICreatioAuthProvider } from '../auth';
import { CreatioClientConfig } from '../client-config';

type RequestFactory = () => Promise<RequestInit>;
type SuccessHandler<T> = (response: Response, duration: number) => Promise<T>;
type ErrorHandler<T> = (response: Response, duration: number) => Promise<T>;

type LogContext = Record<string, any>;

export class CreatioHttpClient {
	private readonly _config: CreatioClientConfig;
	private readonly _authManager: CreatioAuthManager;
	private readonly _normalizedBaseUrl: string;

	public get authProvider(): ICreatioAuthProvider {
		return this._authManager.getProvider();
	}

	public get normalizedBaseUrl(): string {
		return this._normalizedBaseUrl;
	}

	public get odataRoot(): string {
		return `${this._normalizedBaseUrl}/0/odata`;
	}

	constructor(config: CreatioClientConfig, authManager: CreatioAuthManager) {
		this._config = config;
		this._authManager = authManager;
		this._normalizedBaseUrl = this._config.baseUrl.replace(/\/$/, '');
	}

	private _logRequest(url: string, requestInit: RequestInit): void {
		log.info('creatio.http.request', {
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
		log.warn('creatio.http.401_response', {
			url,
			status: response.status,
			triedRefresh: hasTriedRefresh,
			responseHeaders: Object.fromEntries(response.headers.entries()),
		});
	}

	public async getJsonHeaders(): Promise<Record<string, string>> {
		return this.authProvider.getHeaders(JSON_ACCEPT, true);
	}

	public async getXmlHeaders(): Promise<Record<string, string>> {
		return this.authProvider.getHeaders(XML_ACCEPT, false);
	}

	public async getPostHeaders(): Promise<Record<string, string>> {
		const headers = await this.getJsonHeaders();
		return {
			...headers,
			'Content-Type': 'application/json',
		};
	}

	public async createPostRequest(body?: any): Promise<RequestInit> {
		const headers = await this.getPostHeaders();
		return {
			method: 'POST',
			headers,
			body: body ? JSON.stringify(body) : JSON.stringify({}),
		};
	}

	public async fetchJson(url: string, initFactory: RequestFactory) {
		const response = await this.fetchWithAuth(url, initFactory);
		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`creatio_http_error:${response.status} ${errorText}`);
		}
		return response.json();
	}

	public async fetchText(url: string, initFactory: RequestFactory) {
		const response = await this.fetchWithAuth(url, initFactory);
		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`creatio_http_error:${response.status} ${errorText}`);
		}
		return response.text();
	}

	public async fetchWithAuth(url: string, initFactory: RequestFactory): Promise<Response> {
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

	public async executeWithTiming<T>(
		operation: string,
		url: string,
		request: () => Promise<Response>,
		successHandler: SuccessHandler<T>,
		errorHandler: ErrorHandler<T>,
		logContext: LogContext = {},
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
			log.error(`creatio.http.${operation}.error`, {
				...logContext,
				url,
				error: String(error?.message ?? error),
				duration,
			});
			throw error;
		}
	}

	public async handleErrorResponse(
		operation: string,
		response: Response,
		duration: number,
		errorPrefix: string,
		logContext: LogContext = {},
	): Promise<never> {
		const errorText = await response.text().catch(() => '');
		log.error(`creatio.http.${operation}.error`, {
			...logContext,
			status: response.status,
			error: errorText,
			duration,
		});
		throw new Error(`${errorPrefix}:${response.status} ${errorText}`);
	}

	public logSuccess(
		operation: string,
		status: number,
		duration: number,
		logContext: LogContext = {},
	) {
		log.info(`creatio.http.${operation}.success`, {
			...logContext,
			status,
			duration,
		});
	}
}
