import { CurrentUserInfo, UserProvider } from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class UserEngine extends BaseEngine {
	private readonly _provider: UserProvider;

	public readonly name = 'user';

	constructor(provider: UserProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public getCurrentUserInfo(): Promise<CurrentUserInfo> {
		return this._provider.getCurrentUserInfo();
	}
}
