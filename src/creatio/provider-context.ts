import { ICreatioAuthProvider } from './auth';
import {
	AdminOperationProvider,
	ConfigurationProvider,
	CrudProvider,
	FeatureCatalogProvider,
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
	/** Present only on the DataService backend (the catalog's virtual entities are DataService-only). */
	featureCatalog?: FeatureCatalogProvider;
	process: ProcessProvider;
	sysSettings: SysSettingsProvider;
	user: UserProvider;
	/** Optional: proactively refresh the schema-freshness snapshot (implemented by
	 *  {@link CreatioServiceContext}; absent on test fakes). */
	warmSchemaCache?(): Promise<void>;
}
