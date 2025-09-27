import { CreatioClientConfig } from '../client-config';

import { ICreatioAuthProvider } from './auth';
import { AuthProviderType, LegacyProvider, OAuth2CodeProvider, OAuth2Provider } from './providers';

export class CreatioAuthManager {
	private readonly _provider: ICreatioAuthProvider;

	constructor(private readonly _config: CreatioClientConfig) {
		const authKind = this._config.auth.kind;
		if (authKind === AuthProviderType.OAuth2) {
			this._provider = new OAuth2Provider(this._config);
		} else if (authKind === AuthProviderType.OAuth2Code) {
			this._provider = new OAuth2CodeProvider(this._config);
		} else if (authKind === AuthProviderType.Legacy) {
			this._provider = new LegacyProvider(this._config);
		} else {
			throw new Error('unsupported_auth_config');
		}
	}

	public getProvider(): ICreatioAuthProvider {
		return this._provider;
	}
}
