import { CrudBackend } from '../client-config';
import { CrudProvider } from '../contracts';

import { DataServiceCrudProvider } from './dataservice/data-service-crud-provider';
import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './odata/metadata-store';
import { ODataCrudProvider } from './odata/odata-crud-provider';
import { SchemaFreshnessGate } from './schema-freshness-gate';

export interface CrudProviderDeps {
	client: CreatioHttpClient;
	metadataStore: ODataMetadataStore;
	/** Shared schema-freshness gate (content-validated cache). Optional: omitted in tests, where
	 *  schema caches stay purely TTL-driven. */
	freshness?: SchemaFreshnessGate;
}

/**
 * Selects the CRUD provider for the configured backend — the same per-deployment,
 * one-per-process pattern as {@link CreatioAuthManager}. Defaults to DataService (Creatio's
 * native data API). This is the single extension point for adding a CRUD backend: implement
 * {@link CrudProvider} and add a branch here; nothing above the provider interface changes.
 */
export function createCrudProvider(
	backend: CrudBackend | undefined,
	deps: CrudProviderDeps,
): CrudProvider {
	switch (backend ?? 'dataservice') {
		case 'dataservice':
			return new DataServiceCrudProvider(
				deps.client,
				deps.freshness ? { freshness: deps.freshness } : {},
			);
		case 'odata':
			return new ODataCrudProvider(deps.client, deps.metadataStore);
		default:
			throw new Error(`unsupported_crud_backend:${backend}`);
	}
}
