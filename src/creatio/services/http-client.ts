import log from '../../log';
import { JSON_ACCEPT, XML_ACCEPT } from '../../types';
import { getBaseUrlOverride } from '../../utils';
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

	/**
	 * Effective Creatio instance base for the current request. A per-request override is honored
	 * only in gateway mode (the trusted Control-Plane sets `X-Creatio-Base-Url` for multi-tenant
	 * routing); the delegated edge never populates it, so a client cannot redirect calls elsewhere.
	 */
	public get normalizedBaseUrl(): string {
		const override = getBaseUrlOverride();
		return override ? override.replace(/\/$/, '') : this._normalizedBaseUrl;
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
		});
	}

	/**
	 * A dead/expired Creatio session usually surfaces as a clean `401` (legacy sends
	 * `ForceUseSession: true` precisely to get that), but on some endpoints/configs an expired
	 * cookie session instead bounces to the login page — followed by `fetch` into a `200 text/html`.
	 * Our data APIs (OData/DataService/config service) never legitimately return HTML, so a followed
	 * redirect to HTML is treated as an auth bounce too, and one re-auth + retry is attempted.
	 */
	private _looksLikeAuthBounce(response: Response): boolean {
		if (response.status === 401) {
			return true;
		}
		if (response.redirected) {
			const contentType = response.headers.get('content-type') ?? '';
			return contentType.includes('text/html');
		}
		return false;
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
			if (!this._looksLikeAuthBounce(response)) {
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

	/**
	 * Common service-call shape: time the request, parse on 2xx via `onSuccess`, and on a
	 * non-2xx route through {@link handleErrorResponse} with `errorPrefix`. Removes the
	 * identical error-handler closure every provider used to repeat around
	 * {@link executeWithTiming}.
	 */
	public async request<T>(
		operation: string,
		url: string,
		buildRequest: () => Promise<Response>,
		onSuccess: SuccessHandler<T>,
		opts: { errorPrefix: string; logContext?: LogContext },
	): Promise<T> {
		const logContext = opts.logContext ?? {};
		return this.executeWithTiming(
			operation,
			url,
			buildRequest,
			onSuccess,
			(response, duration) =>
				// Include `url` in the error log (it was passed explicitly at the old call sites).
				this.handleErrorResponse(operation, response, duration, opts.errorPrefix, {
					...logContext,
					url,
				}),
			logContext,
		);
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
