import { CreatioAuthManager, ICreatioAuthProvider } from '../auth';
import { CreatioClientConfig } from '../client-config';
import {
	AdminOperationProvider,
	ConfigurationProvider,
	CrudProvider,
	FeatureProvider,
	ProcessProvider,
	SysSettingsProvider,
	UserProvider,
} from '../contracts';
import { CreatioProviderContext } from '../provider-context';

import { AdminOperationServiceProvider } from './admin-operation-service-provider';
import { ClientCacheHashClient } from './client-cache-hash-client';
import { ConfigurationServiceProvider } from './configuration-service-provider';
import { createCrudProvider } from './crud-provider-factory';
import { FeatureServiceProvider } from './feature-service-provider';
import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './odata/metadata-store';
import { ProcessServiceProvider } from './process-service-provider';
import { SchemaFreshnessGate } from './schema-freshness-gate';
import { SysSettingsServiceProvider } from './sys-settings-service-provider';
import { UserInfoProvider } from './user-info-provider';

export class CreatioServiceContext implements CreatioProviderContext {
	private readonly _config: CreatioClientConfig;
	private readonly _authManager: CreatioAuthManager;
	private readonly _httpClient: CreatioHttpClient;
	private readonly _freshness: SchemaFreshnessGate;

	public readonly kind = 'creatio-services';
	public readonly adminOperation: AdminOperationProvider;
	public readonly configuration: ConfigurationProvider;
	public readonly crud: CrudProvider;
	public readonly feature: FeatureProvider;
	public readonly process: ProcessProvider;
	public readonly sysSettings: SysSettingsProvider;
	public readonly user: UserProvider;

	public get authProvider(): ICreatioAuthProvider {
		return this._authManager.getProvider();
	}

	constructor(config: CreatioClientConfig) {
		this._config = config;
		this._authManager = new CreatioAuthManager(this._config);
		this._httpClient = new CreatioHttpClient(this._config, this._authManager);
		// Content-validated schema freshness: polls Creatio's own client-cache hash stamp
		// (`/api/ClientCache/Hashes`) so cached schemas/metadata invalidate when the data model
		// changes — the same signal the Freedom UI uses. Shared by both CRUD backends.
		this._freshness = new SchemaFreshnessGate(new ClientCacheHashClient(this._httpClient));
		const metadataStore = new ODataMetadataStore(this._httpClient, this._freshness);
		this.adminOperation = new AdminOperationServiceProvider(this._httpClient);
		this.configuration = new ConfigurationServiceProvider(this._httpClient);
		this.crud = createCrudProvider(config.crudBackend, {
			client: this._httpClient,
			metadataStore,
			freshness: this._freshness,
		});
		this.feature = new FeatureServiceProvider(this._httpClient);
		this.process = new ProcessServiceProvider(this._httpClient);
		this.sysSettings = new SysSettingsServiceProvider(this._httpClient);
		this.user = new UserInfoProvider(this._httpClient);
	}

	/** Proactively refresh the schema-freshness snapshot for the current base URL. Lets the
	 *  single-session keep-alive tick double as a cache-freshness check, so its periodic ping isn't
	 *  wasted. Best-effort: the gate already swallows endpoint failures. */
	public async warmSchemaCache(): Promise<void> {
		await this._freshness.getSchemaVersion(this._httpClient.normalizedBaseUrl);
	}
}
