import { CreatioHttpClient } from '../http-client';

/**
 * Thin transport for the DataService JSON endpoint
 * (`/0/DataService/json/SyncReply/<Operation>`). Owns the URL shape, the POST plumbing, and
 * the logical-failure check so the CRUD provider and schema helper share one code path.
 * DataService answers HTTP 200 even on logical failures, signalling them via
 * `success: false` + `responseStatus`; `checkSuccess` (writes) turns that into an error.
 * Reads skip the flag and rely on the returned `rows` (a SelectQuery does not reliably set
 * `success`).
 */
export class DataServiceTransport {
	private readonly _client: CreatioHttpClient;

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	public endpoint(operation: string): string {
		return `${this._client.normalizedBaseUrl}/0/DataService/json/SyncReply/${operation}`;
	}

	private _assertSuccess(operation: string, body: any): void {
		if (body && body.success === false) {
			const rs = body.responseStatus ?? {};
			const message =
				rs.Message ??
				rs.message ??
				body.errorInfo?.message ??
				body.errorInfo?.Message ??
				'unknown_error';
			throw new Error(`creatio_dataservice_${operation}_error:${message}`);
		}
	}

	public async post(
		operation: string,
		payload: unknown,
		opts: { logContext?: Record<string, unknown>; checkSuccess?: boolean } = {},
	): Promise<any> {
		const url = this.endpoint(operation);
		const logContext = opts.logContext ?? {};
		return this._client.request(
			`dataservice.${operation}`,
			url,
			async () => {
				const init = await this._client.createPostRequest(payload);
				return this._client.fetchWithAuth(url, async () => init);
			},
			async (response, duration) => {
				const body = await response.json().catch(() => ({}));
				if (opts.checkSuccess) {
					this._assertSuccess(operation, body);
				}
				this._client.logSuccess(
					`dataservice.${operation}`,
					response.status,
					duration,
					logContext,
				);
				return body;
			},
			{ errorPrefix: `creatio_dataservice_${operation}_failed`, logContext },
		);
	}
}
