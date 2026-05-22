import { ClearFeatureCacheResult, FeatureProvider } from '../../providers';
import { CreatioEngine } from '../engine';

export class FeatureEngine implements CreatioEngine {
	private readonly _provider: FeatureProvider;

	public readonly name = 'feature';

	constructor(provider: FeatureProvider) {
		this._provider = provider;
	}

	public get kind(): string {
		return this._provider.kind;
	}

	public clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult> {
		return this._provider.clearFeaturesCache(featureCode);
	}
}
