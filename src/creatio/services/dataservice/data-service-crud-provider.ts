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

import { DataServiceQueryBuilder } from './data-service-query-builder';
import { DataServiceSelectQuery } from './data-service-types';

/**
 * SKELETON for the planned DataService-backed CRUD provider (alternative to OData,
 * selected per-deployment via `CREATIO_CRUD_BACKEND=dataservice`). The selection seam,
 * config plumbing, and the pure query-builder groundwork are real and tested; the
 * transport wiring to `/0/DataService/json/SyncReply/*` is deferred to the dedicated
 * DataService task (it depends on the neutral query-contract rework, audit finding #9).
 *
 * Until then every CRUD method fails fast with a clear, greppable error rather than
 * silently misbehaving, so accidentally selecting this backend is obvious.
 */
export class DataServiceCrudProvider implements CrudProvider {
	private readonly _client: CreatioHttpClient;
	private readonly _queryBuilder: DataServiceQueryBuilder;

	public readonly kind = 'creatio-dataservice';

	constructor(client: CreatioHttpClient, queryBuilder = new DataServiceQueryBuilder()) {
		this._client = client;
		this._queryBuilder = queryBuilder;
	}

	/** Visible for the upcoming read implementation + tests: build (don't send) the payload. */
	public buildSelectQuery(query: ReadQuery): DataServiceSelectQuery {
		return this._queryBuilder.buildSelectQuery(query);
	}

	private _notImplemented(operation: string): never {
		throw new Error(
			`dataservice_not_implemented:${operation} — DataService CRUD backend is groundwork only; ` +
				`use CREATIO_CRUD_BACKEND=odata until the DataService provider is completed`,
		);
	}

	public listEntitySets(): Promise<string[]> {
		return this._notImplemented('listEntitySets');
	}

	public describeEntity(_entitySet: string): Promise<EntitySchemaDescription> {
		return this._notImplemented('describeEntity');
	}

	public read(_query: ReadQuery): Promise<ReadResult> {
		return this._notImplemented('read');
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
