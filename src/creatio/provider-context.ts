import { ICreatioAuthProvider } from './auth';
import {
	CrudProvider,
	FeatureProvider,
	ProcessProvider,
	SysSettingsProvider,
	UserProvider,
} from './providers';

export interface CreatioProviderContext {
	authProvider: ICreatioAuthProvider;
	crud: CrudProvider;
	feature: FeatureProvider;
	process: ProcessProvider;
	sysSettings: SysSettingsProvider;
	user: UserProvider;
}
