import { ICreatioAuthProvider } from './auth';
import { CrudProvider, ProcessProvider, SysSettingsProvider, UserProvider } from './providers';

export interface CreatioProviderContext {
	authProvider: ICreatioAuthProvider;
	crud: CrudProvider;
	process: ProcessProvider;
	sysSettings: SysSettingsProvider;
	user: UserProvider;
}
