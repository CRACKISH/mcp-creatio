import { CurrentUserInfo, UserProvider } from '../../providers';
import { CreatioEngine } from '../engine';

export class UserEngine implements CreatioEngine {
	private readonly _provider: UserProvider;

	public readonly name = 'user';

	constructor(provider: UserProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public getCurrentUserInfo(): Promise<CurrentUserInfo> {
		return this._provider.getCurrentUserInfo();
	}
}
