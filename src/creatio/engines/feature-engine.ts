import {
	ClearFeatureCacheResult,
	FeatureCatalogProvider,
	FeatureDetails,
	FeatureListQuery,
	FeatureListResult,
	FeatureProvider,
	FeatureStateChangeResult,
	SetFeatureStateRequest,
} from '../contracts';

import { BaseEngine, EngineEnv } from './engine';

export class FeatureEngine extends BaseEngine {
	private readonly _provider: FeatureProvider;
	private readonly _catalog: FeatureCatalogProvider | undefined;

	public readonly name = 'feature';

	public get kind(): string {
		return this._provider.kind;
	}

	/** Whether the feature catalog (list/get/set) is available — DataService backend only. */
	public get hasCatalog(): boolean {
		return this._catalog !== undefined;
	}

	constructor(provider: FeatureProvider, catalog?: FeatureCatalogProvider, env?: EngineEnv) {
		super(env);
		this._provider = provider;
		this._catalog = catalog;
	}

	private _requireCatalog(): FeatureCatalogProvider {
		if (!this._catalog) {
			throw new Error('feature_catalog_unavailable');
		}
		return this._catalog;
	}

	public clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult> {
		return this._mutate('feature.clear-cache', { featureCode: featureCode ?? null }, () =>
			this._provider.clearFeaturesCache(featureCode),
		);
	}

	// Async so a missing catalog surfaces as a rejection, like every other engine failure.
	public async listFeatures(query: FeatureListQuery): Promise<FeatureListResult> {
		return this._requireCatalog().listFeatures(query);
	}

	public async getFeature(code: string): Promise<FeatureDetails> {
		return this._requireCatalog().getFeature(code);
	}

	public setFeatureState(request: SetFeatureStateRequest): Promise<FeatureStateChangeResult> {
		const { code, state, adminUnitId } = request;
		return this._mutate(
			'feature.set-state',
			{ code, state, adminUnitId: adminUnitId ?? null },
			() => this._requireCatalog().setFeatureState(request),
		);
	}
}
