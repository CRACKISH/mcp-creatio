import { NavigationProvider } from '../contracts';

import { assertEntityName } from './entity-name';
import { CreatioHttpClient } from './http-client';
import { isGuid } from './identifiers';

// Creatio's own record router: it finds the record's page server-side (classic card or Freedom UI
// form page, on .NET Framework and .NET 8 alike), opens the home page for an object without one,
// and sends an anonymous visitor through login and back (verified live on both runtimes).
const RECORD_REDIRECT_PATH = '/0/rest/NavigationService/Redirect';

export class NavigationServiceProvider implements NavigationProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-navigation-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	public recordUrl(entity: string, id: string): string {
		if (!isGuid(id)) {
			throw new Error(`invalid_record_id:${id}`);
		}
		// The per-request base honors the gateway tenant override, so the link targets the
		// caller's instance.
		const url = new URL(this._client.normalizedBaseUrl + RECORD_REDIRECT_PATH);
		url.searchParams.set('schemaName', assertEntityName(entity));
		url.searchParams.set('recordId', id);
		return url.toString();
	}
}
