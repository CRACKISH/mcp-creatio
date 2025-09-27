import { CreatioClientAuthConfig, CreatioClientConfig } from '../../client-config';
import { ICreatioAuthProvider } from '../auth';

import { AuthProviderType } from './type';

export abstract class BaseProvider<T extends CreatioClientAuthConfig = CreatioClientAuthConfig>
	implements ICreatioAuthProvider
{
	protected get authConfig(): T {
		return this.config.auth as T;
	}

	public get type(): AuthProviderType {
		return this.authConfig.kind;
	}

	constructor(protected readonly config: CreatioClientConfig) {}

	public getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>> {
		throw new Error('Method not implemented.');
	}

	public refresh(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	public revoke(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	public getAuthorizeUrl(state: string): Promise<string> {
		throw new Error('Method not implemented.');
	}

	public finishAuthorization(code: string): Promise<void> {
		throw new Error('Method not implemented.');
	}
}
