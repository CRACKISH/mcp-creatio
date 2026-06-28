import { ClearFeatureCacheResult, FeatureProvider } from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class FeatureEngine extends BaseEngine {
	private readonly _provider: FeatureProvider;

	public readonly name = 'feature';

	public get kind(): string {
		return this._provider.kind;
	}

	constructor(provider: FeatureProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
	}

	public clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult> {
		return this._mutate('feature.clear-cache', { featureCode: featureCode ?? null }, () =>
			this._provider.clearFeaturesCache(featureCode),
		);
	}
}
