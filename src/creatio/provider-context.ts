import { ICreatioAuthProvider } from './auth';
import {
	AdminOperationProvider,
	CrudProvider,
	FeatureProvider,
	ProcessProvider,
	SysSettingsProvider,
	UserProvider,
} from './providers';

export interface CreatioProviderContext {
	authProvider: ICreatioAuthProvider;
	adminOperation: AdminOperationProvider;
	crud: CrudProvider;
	feature: FeatureProvider;
	process: ProcessProvider;
	sysSettings: SysSettingsProvider;
	user: UserProvider;
}
