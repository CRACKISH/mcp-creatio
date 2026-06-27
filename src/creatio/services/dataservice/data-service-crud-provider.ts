import log from '../../../log';
import {
	CrudDeleteParams,
	CrudProvider,
	CrudUpdateParams,
	CrudWriteParams,
	EntitySchemaDescription,
	ReadQuery,
	ReadResult,
} from '../../contracts';
import { CreatioHttpClient } from '../http-client';

import { COUNT_COLUMN_ALIAS, DataServiceQueryBuilder } from './data-service-query-builder';
import { DataServiceSelectQuery } from './data-service-types';

const ENTITY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * DataService-backed CRUD provider (alternative to OData, selected via
 * `CREATIO_CRUD_BACKEND=dataservice`). Talks to `/0/DataService/json/SyncReply/*` using the
 * neutral query contract: the query builder/filter-translator produce the native
 * `SelectQuery`/`Filters` payloads, and responses (`rows`/`rowsAffected`) are normalized to
 * {@link ReadResult} so callers above the provider never see the dialect.
 */
export class DataServiceCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _queryBuilder: DataServiceQueryBuilder;

	public readonly kind = 'creatio-dataservice';

	constructor(client: CreatioHttpClient, queryBuilder = new DataServiceQueryBuilder()) {
		this._client = client;
		this._queryBuilder = queryBuilder;
	}

	/** Visible for tests: build (don't send) the SelectQuery payload. */
	public buildSelectQuery(query: ReadQuery): DataServiceSelectQuery {
		return this._queryBuilder.buildSelectQuery(query);
	}

	private _validateEntityName(entity: string): string {
		// DataService schema names are simple identifiers; reject anything else so a name can
		// never alter the request envelope or be used for injection.
		if (!entity || !ENTITY_NAME_PATTERN.test(entity)) {
			throw new Error(`invalid_entity_name:${entity}`);
		}
		return entity;
	}

	private _endpoint(operation: string): string {
		return `${this._client.normalizedBaseUrl}/0/DataService/json/SyncReply/${operation}`;
	}

	/**
	 * POST a DataService payload and return the parsed JSON body. DataService answers 200 even
	 * for logical failures, signalling them via `success: false` + `responseStatus`; when
	 * `checkSuccess` is on (writes) we surface that as an error. Reads skip the flag and rely on
	 * the returned rows (a SelectQuery does not reliably set `success`).
	 */
	private async _post(
		operation: string,
		payload: unknown,
		opts: { logContext?: Record<string, unknown>; checkSuccess?: boolean } = {},
	): Promise<any> {
		const url = this._endpoint(operation);
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
				this._client.logSuccess(`dataservice.${operation}`, response.status, duration, logContext);
				return body;
			},
			{ errorPrefix: `creatio_dataservice_${operation}_failed`, logContext },
		);
	}

	private _assertSuccess(operation: string, body: any): void {
		if (body && body.success === false) {
			const rs = body.responseStatus ?? {};
			const message =
				rs.Message ?? rs.message ?? body.errorInfo?.message ?? body.errorInfo?.Message ?? 'unknown_error';
			throw new Error(`creatio_dataservice_${operation}_error:${message}`);
		}
	}

	private _rows(body: any): any[] {
		return Array.isArray(body?.rows) ? body.rows : [];
	}

	private _extractCount(body: any): number | undefined {
		const rows = this._rows(body);
		const raw = rows.length ? rows[0]?.[COUNT_COLUMN_ALIAS] : undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	public async read(query: ReadQuery): Promise<ReadResult> {
		this._validateEntityName(query.entity);
		const select = this._queryBuilder.buildSelectQuery(query);
		const body = await this._post('SelectQuery', select, {
			logContext: { entity: query.entity, top: query.top, skip: query.skip },
		});
		const items = this._rows(body);
		if (body?.notFoundColumns?.length) {
			log.warn('creatio.dataservice.read.not_found_columns', {
				entity: query.entity,
				notFoundColumns: body.notFoundColumns,
			});
		}
		if (!query.count) {
			return { items };
		}
		const countBody = await this._post('SelectQuery', this._queryBuilder.buildCountQuery(query), {
			logContext: { entity: query.entity, count: true },
		});
		const totalCount = this._extractCount(countBody);
		return totalCount !== undefined ? { items, totalCount } : { items };
	}

	private _notImplemented(operation: string): never {
		throw new Error(
			`dataservice_not_implemented:${operation} — pending the DataService write/schema task`,
		);
	}

	public listEntitySets(): Promise<string[]> {
		return this._notImplemented('listEntitySets');
	}

	public describeEntity(_entitySet: string): Promise<EntitySchemaDescription> {
		return this._notImplemented('describeEntity');
	}

	public create(_params: CrudWriteParams): Promise<any> {
		return this._notImplemented('create');
	}

	public update(_params: CrudUpdateParams): Promise<any> {
		return this._notImplemented('update');
	}

	public delete(_params: CrudDeleteParams): Promise<any> {
		return this._notImplemented('delete');
	}
}
