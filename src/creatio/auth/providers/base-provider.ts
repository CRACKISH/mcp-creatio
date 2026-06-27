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

	// Core capability — every concrete provider must implement these. Optional capabilities
	// (revoke, interactive authorize/finish) live on the IRevocable/IInteractive interfaces and
	// are added only by the providers that support them, instead of throwing stubs here (ISP/LSP).
	public abstract getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;

	public abstract refresh(): Promise<void>;

	public cancelAllRefresh(): void {
		// No background refresh timers by default; OAuth2CodeProvider overrides this.
	}
}
