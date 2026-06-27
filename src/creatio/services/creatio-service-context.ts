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
import { ConfigurationServiceProvider } from './configuration-service-provider';
import { createCrudProvider } from './crud-provider-factory';
import { FeatureServiceProvider } from './feature-service-provider';
import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './odata/metadata-store';
import { ProcessServiceProvider } from './process-service-provider';
import { SysSettingsServiceProvider } from './sys-settings-service-provider';
import { UserInfoProvider } from './user-info-provider';

export class CreatioServiceContext implements CreatioProviderContext {
	private readonly _config: CreatioClientConfig;
	private readonly _authManager: CreatioAuthManager;
	private readonly _httpClient: CreatioHttpClient;

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
		const metadataStore = new ODataMetadataStore(this._httpClient);
		this.adminOperation = new AdminOperationServiceProvider(this._httpClient);
		this.configuration = new ConfigurationServiceProvider(this._httpClient);
		this.crud = createCrudProvider(config.crudBackend, {
			client: this._httpClient,
			metadataStore,
		});
		this.feature = new FeatureServiceProvider(this._httpClient);
		this.process = new ProcessServiceProvider(this._httpClient);
		this.sysSettings = new SysSettingsServiceProvider(this._httpClient);
		this.user = new UserInfoProvider(this._httpClient);
	}
}
