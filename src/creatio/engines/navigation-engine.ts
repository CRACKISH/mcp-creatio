import { NavigationProvider } from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class NavigationEngine extends BaseEngine {
	private readonly _provider: NavigationProvider;

	public readonly name = 'navigation';

	public get kind(): string {
		return this._provider.kind;
	}

	constructor(provider: NavigationProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public recordUrl(entity: string, id: string): string {
		return this._provider.recordUrl(entity, id);
	}
}
