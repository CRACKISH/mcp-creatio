import { CrudBackend } from '../client-config';
import { CrudProvider } from '../contracts';

import { DataServiceCrudProvider } from './dataservice/data-service-crud-provider';
import { DataServiceSchemaProvider } from './dataservice/data-service-schema';
import { DataServiceTransport } from './dataservice/data-service-transport';
import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './odata/metadata-store';
import { ODataCrudProvider } from './odata/odata-crud-provider';
import { SchemaFreshnessGate } from './schema-freshness-gate';
import { UserClockSource } from './user-time-zone';

export interface CrudProviderDeps {
	client: CreatioHttpClient;
	metadataStore: ODataMetadataStore;
	/** Shared schema-freshness gate (content-validated cache). Optional: omitted in tests, where
	 *  schema caches stay purely TTL-driven. */
	freshness?: SchemaFreshnessGate;
	/** The calling user's zone, for date/time conversion. Optional: tests default to UTC. */
	clock?: UserClockSource;
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
			return new DataServiceCrudProvider(deps.client, {
				...(deps.freshness ? { freshness: deps.freshness } : {}),
				...(deps.clock ? { clock: deps.clock } : {}),
			});
		case 'odata':
			// OData's metadata types every date/time column alike; Creatio's own schema (served by
			// DataService on both runtimes) tells a Date from a DateTime.
			return new ODataCrudProvider(deps.client, deps.metadataStore, undefined, {
				schema: new DataServiceSchemaProvider(
					new DataServiceTransport(deps.client),
					undefined,
					undefined,
					deps.freshness,
				),
				...(deps.clock ? { clock: deps.clock } : {}),
			});
		default:
			throw new Error(`unsupported_crud_backend:${backend}`);
	}
}
