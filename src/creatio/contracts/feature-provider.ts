export interface ClearFeatureCacheResult {
	success: boolean;
	featureCode?: string;
	message: string;
}

export interface FeatureProvider {
	readonly kind: string;
	clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult>;
}
