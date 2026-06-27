import { CreatioClientConfig } from '../client-config';

import { ICreatioAuthProvider } from './auth';
import {
	AuthProviderType,
	BrokerProvider,
	LegacyProvider,
	OAuth2BearerProvider,
	OAuth2Provider,
} from './providers';

export class CreatioAuthManager {
	private readonly _config: CreatioClientConfig;
	private readonly _provider: ICreatioAuthProvider;

	constructor(config: CreatioClientConfig) {
		this._config = config;
		const authKind = this._config.auth.kind;
		if (authKind === AuthProviderType.OAuth2) {
			this._provider = new OAuth2Provider(this._config);
		} else if (authKind === AuthProviderType.OAuth2Bearer) {
			this._provider = new OAuth2BearerProvider(this._config);
		} else if (authKind === AuthProviderType.Broker) {
			this._provider = new BrokerProvider(this._config);
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
