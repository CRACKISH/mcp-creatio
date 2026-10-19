import log from '../../log';
import {
	FeatureCatalogProvider,
	FeatureDetails,
	FeatureListQuery,
	FeatureListResult,
	FeatureProvider,
	FeatureStateChange,
	SetFeatureStateRequest,
} from '../contracts';

import { AppFeatureStore, FeatureRecord, withoutId } from './app-feature-store';

function sameId(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

function findOverride<T extends { adminUnitId: string }>(
	items: readonly T[],
	adminUnitId: string,
): T | undefined {
	return items.find((item) => sameId(item.adminUnitId, adminUnitId));
}

/**
 * Feature-toggle catalog over {@link AppFeatureStore}. A state change follows the Freedom UI feature
 * page: write the virtual entity, clear that feature's cache (so the new state is effective
 * immediately), then re-read and verify — a write the platform silently ignored surfaces as an
 * error instead of a false success.
 */
export class FeatureCatalogService implements FeatureCatalogProvider {
	private readonly _store: AppFeatureStore;
	private readonly _cache: FeatureProvider;

	public readonly kind = 'creatio-app-feature';

	constructor(store: AppFeatureStore, cache: FeatureProvider) {
		this._store = store;
		this._cache = cache;
	}

	private async _require(code: string): Promise<FeatureRecord> {
		const record = await this._store.findByCode(code);
		if (!record) {
			throw new Error(`feature_not_found:${code}`);
		}
		return record;
	}

	private async _details(record: FeatureRecord): Promise<FeatureDetails> {
		const overrides = await this._store.overrides(record.id);
		return { ...withoutId(record), overrides: overrides.map(withoutId) };
	}

	private async _applyOverride(
		featureId: string,
		adminUnitId: string,
		state: FeatureStateChange,
	): Promise<void> {
		const existing = findOverride(await this._store.overrides(featureId), adminUnitId);
		if (state === 'inherit') {
			if (existing) {
				await this._store.removeOverride(existing.id);
			}
			return;
		}
		const enabled = state === 'enabled';
		if (!existing) {
			await this._store.addOverride(featureId, adminUnitId, enabled);
		} else if (existing.enabled !== enabled) {
			await this._store.updateOverride(existing.id, enabled);
		}
	}

	private _isApplied(request: SetFeatureStateRequest, feature: FeatureDetails): boolean {
		const enabled = request.state === 'enabled';
		if (!request.adminUnitId) {
			return feature.enabledByDefault === enabled;
		}
		const override = findOverride(feature.overrides, request.adminUnitId);
		return request.state === 'inherit' ? !override : override?.enabled === enabled;
	}

	public listFeatures(query: FeatureListQuery): Promise<FeatureListResult> {
		return this._store.list(query);
	}

	public async getFeature(code: string): Promise<FeatureDetails> {
		return this._details(await this._require(code));
	}

	public async setFeatureState(request: SetFeatureStateRequest): Promise<FeatureDetails> {
		const { code, state, adminUnitId } = request;
		if (state === 'inherit' && !adminUnitId) {
			throw new Error('feature_inherit_requires_admin_unit');
		}
		// Read right before writing: a feature without a DB row has a per-session temporary id.
		const record = await this._require(code);
		if (adminUnitId) {
			await this._applyOverride(record.id, adminUnitId, state);
		} else {
			await this._store.setDefault(record.id, state === 'enabled');
		}
		await this._cache.clearFeaturesCache(code);
		const feature = await this.getFeature(code);
		if (!this._isApplied(request, feature)) {
			log.error('creatio.feature.state_not_applied', { code, state, adminUnitId });
			throw new Error(`feature_state_not_applied:${code}`);
		}
		return feature;
	}
}
