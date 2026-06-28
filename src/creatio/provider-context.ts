import { ICreatioAuthProvider } from './auth';
import {
	AdminOperationProvider,
	ConfigurationProvider,
	CrudProvider,
	FeatureProvider,
	ProcessProvider,
	SysSettingsProvider,
	UserProvider,
} from './contracts';

export interface CreatioProviderContext {
	authProvider: ICreatioAuthProvider;
	adminOperation: AdminOperationProvider;
	configuration: ConfigurationProvider;
	crud: CrudProvider;
	feature: FeatureProvider;
	process: ProcessProvider;
	sysSettings: SysSettingsProvider;
	user: UserProvider;
	/** Optional: proactively refresh the schema-freshness snapshot (implemented by
	 *  {@link CreatioServiceContext}; absent on test fakes). */
	warmSchemaCache?(): Promise<void>;
}
