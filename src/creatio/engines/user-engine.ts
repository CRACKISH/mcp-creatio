import { CurrentUserInfo, UserProvider } from '../contracts';
import { describeUserZone } from '../temporal';

import { BaseEngine, EngineEnv } from './engine';

export class UserEngine extends BaseEngine {
	private readonly _provider: UserProvider;

	public readonly name = 'user';

	public get kind(): string {
		return this._provider.kind;
	}

	constructor(provider: UserProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	/** The user, plus the profile zone the record tools take and return date/times in: the IANA
	 *  `timeZone` and today's `utcOffset` (Creatio itself reports only a Windows zone id). */
	public async getCurrentUserInfo(): Promise<CurrentUserInfo> {
		const body = await this._provider.getCurrentUserInfo();
		if (!body?.userInfo || typeof body.userInfo !== 'object') {
			return body;
		}
		return { ...body, userInfo: { ...body.userInfo, ...describeUserZone(body) } };
	}
}
