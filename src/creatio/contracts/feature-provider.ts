export interface ClearFeatureCacheResult {
	success: boolean;
	featureCode?: string;
	message: string;
}

/**
 * One feature toggle as Creatio resolves it — from ANY source (`DbFeatureProvider`, `web.config`,
 * `Metadata`, `GlobalAppSettings`, …), not only the DB-backed ones.
 */
export interface FeatureInfo {
	code: string;
	name: string;
	description?: string;
	/** Where Creatio currently resolves the feature from; a DB row (`DbFeatureProvider`) wins. */
	source: string;
	/** State for everyone without a per-user/role override. */
	enabledByDefault: boolean;
	/** Effective state for the user the MCP acts as. */
	enabledForCurrentUser: boolean;
}

/** A per-user/role override of a feature's default state. */
export interface FeatureOverride {
	adminUnitId: string;
	adminUnitName: string;
	enabled: boolean;
}

export interface FeatureDetails extends FeatureInfo {
	overrides: FeatureOverride[];
}

export interface FeatureListQuery {
	/** Case-insensitive substring of the feature code. */
	search?: string;
	source?: string;
	enabledForCurrentUser?: boolean;
	top: number;
	skip?: number;
}

export interface FeatureListResult {
	items: FeatureInfo[];
	/** Another page exists (Creatio cannot count these virtual rows, so there is no total). */
	hasMore: boolean;
}

/** `inherit` removes a user/role override so the default state applies again. */
export type FeatureStateChange = 'enabled' | 'disabled' | 'inherit';

export interface SetFeatureStateRequest {
	code: string;
	state: FeatureStateChange;
	/** User or role (SysAdminUnit) to override for; omitted ⇒ change the default state. */
	adminUnitId?: string;
}

export interface FeatureProvider {
	readonly kind: string;
	clearFeaturesCache(featureCode?: string): Promise<ClearFeatureCacheResult>;
}

/**
 * The feature-toggle catalog. Reads and writes go through the same virtual entities the Freedom
 * UI feature page uses, so every source is visible and the platform's own listeners persist
 * changes. Those entities are DataService-only, so this port exists only on that backend.
 */
export interface FeatureCatalogProvider {
	readonly kind: string;
	listFeatures(query: FeatureListQuery): Promise<FeatureListResult>;
	/** Throws `feature_not_found:<code>` when Creatio does not know the code. */
	getFeature(code: string): Promise<FeatureDetails>;
	/** Applies the change, clears the feature cache, and returns the re-read feature. */
	setFeatureState(request: SetFeatureStateRequest): Promise<FeatureDetails>;
}
