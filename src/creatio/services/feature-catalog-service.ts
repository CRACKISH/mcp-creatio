import log from '../../log';
import {
	FeatureCatalogProvider,
	FeatureDetails,
	FeatureInfo,
	FeatureListQuery,
	FeatureListResult,
	FeatureProvider,
	FeatureStateChangeResult,
	SetFeatureStateRequest,
} from '../contracts';

import { FeatureStore, withoutId } from './feature-store';

function findOverride<T extends { adminUnitId: string }>(
	items: readonly T[],
	adminUnitId: string,
): T | undefined {
	const id = adminUnitId.toLowerCase();
	return items.find((item) => item.adminUnitId.toLowerCase() === id);
}

/**
 * Feature-toggle catalog over {@link FeatureStore}. A change is saved to the persisted rows (the
 * same rows the Creatio feature page ends up writing), the feature's cache is cleared so it takes
 * effect immediately, and the rows are re-read to verify it — a write Creatio silently ignored
 * surfaces as `feature_state_not_applied` instead of a false success.
 */
export class FeatureCatalogService implements FeatureCatalogProvider {
	private readonly _store: FeatureStore;
	private readonly _cache: FeatureProvider;

	public readonly kind = 'creatio-feature-catalog';

	constructor(store: FeatureStore, cache: FeatureProvider) {
		this._store = store;
		this._cache = cache;
	}

	private async _require(code: string): Promise<FeatureInfo> {
		const feature = await this._store.findByCode(code);
		if (!feature) {
			throw new Error(`feature_not_found:${code}`);
		}
		return feature;
	}

	private async _setDefault(feature: FeatureInfo, enabled: boolean): Promise<void> {
		const row = await this._store.featureRow(feature.code);
		if (!row) {
			await this._store.createFeature(feature, enabled);
		} else if (row.enabledByDefault !== enabled) {
			await this._store.setDefault(row.id, enabled);
		}
	}

	private async _setOverride(
		feature: FeatureInfo,
		{ state, adminUnitId }: SetFeatureStateRequest & { adminUnitId: string },
	): Promise<void> {
		const existing = findOverride(await this._store.overrides(feature.code), adminUnitId);
		if (state === 'inherit') {
			if (existing) {
				await this._store.removeOverride(existing.id);
			}
			return;
		}
		const enabled = state === 'enabled';
		if (existing) {
			if (existing.enabled !== enabled) {
				await this._store.updateOverride(existing.id, enabled);
			}
			return;
		}
		// An override needs the feature's DB row; create it with the CURRENT default so the
		// override never changes the default as a side effect (the platform does the same).
		const row = await this._store.featureRow(feature.code);
		const featureId = row
			? row.id
			: await this._store.createFeature(feature, feature.enabledByDefault);
		await this._store.addOverride(featureId, adminUnitId, enabled);
	}

	/** Best effort: the change is already saved, so a failed clear is reported, not thrown — a
	 *  throw would read as "not done" and invite a retry. */
	private async _clearCache(code: string): Promise<boolean> {
		try {
			await this._cache.clearFeaturesCache(code);
			return true;
		} catch (err) {
			log.warn('creatio.feature.cache_clear_failed', { code, error: String(err) });
			return false;
		}
	}

	/** Verified against the persisted rows, which (unlike the resolved state) do not depend on
	 *  the feature cache. */
	private async _isSaved(
		{ code, state, adminUnitId }: SetFeatureStateRequest,
		feature: FeatureDetails,
	): Promise<boolean> {
		const enabled = state === 'enabled';
		if (!adminUnitId) {
			return (await this._store.featureRow(code))?.enabledByDefault === enabled;
		}
		const override = findOverride(feature.overrides, adminUnitId);
		return state === 'inherit' ? !override : override?.enabled === enabled;
	}

	public listFeatures(query: FeatureListQuery): Promise<FeatureListResult> {
		return this._store.list(query);
	}

	public async getFeature(code: string): Promise<FeatureDetails> {
		const [feature, overrides] = await Promise.all([
			this._require(code),
			this._store.overrides(code),
		]);
		return { ...feature, overrides: overrides.map(withoutId) };
	}

	public async setFeatureState(
		request: SetFeatureStateRequest,
	): Promise<FeatureStateChangeResult> {
		const { code, state, adminUnitId } = request;
		if (state === 'inherit' && !adminUnitId) {
			throw new Error('feature_inherit_requires_admin_unit');
		}
		const feature = await this._require(code);
		if (adminUnitId) {
			await this._setOverride(feature, { ...request, adminUnitId });
		} else {
			await this._setDefault(feature, state === 'enabled');
		}
		const cacheCleared = await this._clearCache(code);
		const updated = await this.getFeature(code);
		if (!(await this._isSaved(request, updated))) {
			log.error('creatio.feature.state_not_applied', { code, state, adminUnitId });
			throw new Error(`feature_state_not_applied:${code}`);
		}
		return { ...updated, cacheCleared };
	}
}
