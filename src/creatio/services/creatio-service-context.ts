import { CreatioAuthManager, ICreatioAuthProvider } from '../auth';
import { CreatioClientConfig } from '../client-config';
import { CreatioProviderContext } from '../provider-context';
import { CrudProvider, ProcessProvider, SysSettingsProvider, UserProvider } from '../providers';

import { CreatioHttpClient } from './http-client';
import { ODataMetadataStore } from './metadata-store';
import { ODataCrudProvider } from './odata-crud-provider';
import { ProcessServiceProvider } from './process-service-provider';
import { SysSettingsServiceProvider } from './sys-settings-service-provider';
import { UserInfoProvider } from './user-info-provider';

export class CreatioServiceContext implements CreatioProviderContext {
	private readonly _config: CreatioClientConfig;
	private readonly _authManager: CreatioAuthManager;
	private readonly _httpClient: CreatioHttpClient;

	public readonly kind = 'creatio-services';
	public readonly crud: CrudProvider;
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
		this.crud = new ODataCrudProvider(this._httpClient, metadataStore);
		this.process = new ProcessServiceProvider(this._httpClient);
		this.sysSettings = new SysSettingsServiceProvider(this._httpClient);
		this.user = new UserInfoProvider(this._httpClient);
	}
}
