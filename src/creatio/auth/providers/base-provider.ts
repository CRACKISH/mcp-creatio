import { CreatioClientAuthConfig, CreatioClientConfig } from '../../client-config';
import { ICreatioAuthProvider } from '../auth';

import { AuthProviderType } from './type';

export abstract class BaseProvider<
	T extends CreatioClientAuthConfig = CreatioClientAuthConfig,
> implements ICreatioAuthProvider {
	protected readonly config: CreatioClientConfig;

	protected get authConfig(): T {
		return this.config.auth as T;
	}

	public get type(): AuthProviderType {
		return this.authConfig.kind;
	}

	constructor(config: CreatioClientConfig) {
		this.config = config;
	}

	// The whole provider capability: build auth headers + refresh on 401. There is no
	// token-issuing / interactive / revoke surface on a provider — external clients authenticate
	// against Creatio Identity directly, and broker mode drives the OAuth dance in src/server/oauth/.
	public abstract getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;

	public abstract refresh(): Promise<void>;

	public cancelAllRefresh(): void {
		// No background refresh timers in any current provider; the hook stays for shutdown symmetry.
	}
}
