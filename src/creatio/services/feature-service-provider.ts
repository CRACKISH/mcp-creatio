import { ClearFeatureCacheResult, FeatureProvider } from '../providers';

import { CreatioHttpClient } from './http-client';

export class FeatureServiceProvider implements FeatureProvider {
	private readonly _client: CreatioHttpClient;

	public readonly kind = 'creatio-feature-service';

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _getClearCacheUrl(featureCode?: string): string {
		const base = `${this._client.normalizedBaseUrl}/0/rest/FeatureService/ClearFeaturesCacheForAllUsers`;
		if (!featureCode) {
			return `${base}/`;
		}
		const encoded = Buffer.from(featureCode, 'utf8').toString('base64');
		return `${base}/${encoded}`;
	}

	public async clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult> {
		const url = this._getClearCacheUrl(featureCode);
		return this._client.request<ClearFeatureCacheResult>(
			'clear-features-cache',
			url,
			async () => {
				const headers = await this._client.getJsonHeaders();
				return this._client.fetchWithAuth(url, async () => ({
					method: 'GET',
					headers,
				}));
			},
			async (response, duration) => {
				const message = await response.text();
				this._client.logSuccess('clear-features-cache', response.status, duration, {
					featureCode: featureCode ?? '(all)',
				});
				const result: ClearFeatureCacheResult = { success: true, message };
				if (featureCode !== undefined) {
					result.featureCode = featureCode;
				}
				return result;
			},
			{
				errorPrefix: 'creatio_clear_features_cache_failed',
				logContext: { featureCode: featureCode ?? '(all)' },
			},
		);
	}
}
