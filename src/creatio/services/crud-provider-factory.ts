import { CrudBackend } from '../client-config';
import { CrudProvider } from '../providers';

import { DataServiceCrudProvider } from './dataservice/data-service-crud-provider';
import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './metadata-store';
import { ODataCrudProvider } from './odata-crud-provider';

export interface CrudProviderDeps {
	client: CreatioHttpClient;
	metadataStore: ODataMetadataStore;
}

/**
 * Selects the CRUD provider for the configured backend — the same per-deployment,
 * one-per-process pattern as {@link CreatioAuthManager}. Defaults to OData. This is the
 * single extension point for adding a CRUD backend: implement {@link CrudProvider} and
 * add a branch here; nothing above the provider interface changes.
 */
export function createCrudProvider(
	backend: CrudBackend | undefined,
	deps: CrudProviderDeps,
): CrudProvider {
	switch (backend ?? 'odata') {
		case 'dataservice':
			return new DataServiceCrudProvider(deps.client);
		case 'odata':
			return new ODataCrudProvider(deps.client, deps.metadataStore);
		default:
			throw new Error(`unsupported_crud_backend:${backend}`);
	}
}
