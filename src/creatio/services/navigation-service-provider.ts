import { NavigationProvider } from '../contracts';

import { assertEntityName } from './entity-name';
import { CreatioHttpClient } from './http-client';
import { isGuid } from './identifiers';

// Both routes verified live on .NET Framework and .NET 8. The record router finds the record's
// page server-side (classic card or Freedom UI form page), opens the home page for an object
// without one; both send a signed-out browser through login and back (an API client gets 401).
const RECORD_REDIRECT_PATH = '/0/rest/NavigationService/Redirect';
const FILE_DOWNLOAD_PATH = '/0/rest/FileService/Download';

function assertRecordId(id: string): string {
	if (!isGuid(id)) {
		throw new Error(`invalid_record_id:${id}`);
	}
	return id;
}

export class NavigationServiceProvider implements NavigationProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-navigation-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	/** The per-request base honors the gateway tenant override, so links target the caller's
	 *  instance. */
	private _url(path: string): URL {
		return new URL(this._client.normalizedBaseUrl + path);
	}

	public recordUrl(entity: string, id: string): string {
		const recordId = assertRecordId(id);
		const url = this._url(RECORD_REDIRECT_PATH);
		url.searchParams.set('schemaName', assertEntityName(entity));
		url.searchParams.set('recordId', recordId);
		return url.toString();
	}

	public fileDownloadUrl(fileEntity: string, fileId: string): string {
		const entity = assertEntityName(fileEntity);
		return this._url(`${FILE_DOWNLOAD_PATH}/${entity}/${assertRecordId(fileId)}`).toString();
	}
}
