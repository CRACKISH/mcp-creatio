import { randomUUID } from 'node:crypto';

import {
	CrudProvider,
	FeatureInfo,
	FeatureListQuery,
	FeatureListResult,
	FeatureOverride,
	FilterNode,
	LookupValue,
} from '../contracts';

// Reads go through `AppFeature`, the virtual entity behind the Freedom UI feature page (package
// `FeatureToggling`, DataService-only): it lists features from EVERY source with their resolved
// state. Writes go to the persisted `Feature` / `AdminUnitFeatureState` rows — exactly what the
// virtual entities' save listeners write — because writing through `AppFeature` /
// `AppFeatureState` is not reliable: on .NET 8 an AppFeature update is a silent no-op and an
// AppFeatureState insert fails (their per-session temporary ids). Verified live on both runtimes.
const CATALOG_ENTITY = 'AppFeature';
const FEATURE_TABLE = 'Feature';
const OVERRIDE_TABLE = 'AdminUnitFeatureState';
const CATALOG_COLUMNS = ['Code', 'Name', 'Description', 'Source', 'State', 'StateForCurrentUser'];
// Persisted state values: 0 = disabled, 1 = enabled (2 = "established" is not enabled either).
const ENABLED = 1;
const DISABLED = 0;

/** A feature's persisted `Feature` row (absent for a web.config / metadata feature never changed). */
export interface FeatureRow {
	id: string;
	enabledByDefault: boolean;
}

export interface OverrideRecord extends FeatureOverride {
	id: string;
}

type Row = Record<string, unknown>;

const text = (cell: unknown): string => (cell == null ? '' : String(cell));

/** Rows come normalized by the provider: a lookup is a {@link LookupValue} or `null`. */
const lookup = (cell: unknown): LookupValue | null => (cell as LookupValue | null) ?? null;

const toState = (enabled: boolean): number => (enabled ? ENABLED : DISABLED);

const equals = (field: string, value: unknown): FilterNode => ({
	kind: 'condition',
	field,
	op: 'eq',
	value,
});

function toFeatureInfo(row: Row): FeatureInfo {
	const description = text(row.Description);
	return {
		code: String(row.Code),
		name: text(row.Name),
		...(description ? { description } : {}),
		source: text(row.Source),
		enabledByDefault: row.State === true,
		enabledForCurrentUser: row.StateForCurrentUser === true,
	};
}

function toOverrideRecord(row: Row): OverrideRecord {
	return {
		id: String(row.Id),
		adminUnitId: text(lookup(row.SysAdminUnit)?.value),
		adminUnitName: text(lookup(row.SysAdminUnit)?.displayValue),
		enabled: Number(row.FeatureState) === ENABLED,
	};
}

/** Drops the row id: it is an internal handle, not domain data. */
export function withoutId<T extends { id: string }>({ id: _id, ...rest }: T): Omit<T, 'id'> {
	return rest;
}

/**
 * Data access for feature toggles — the single place that knows the entity, column and state
 * shapes (Information Expert). Built on the neutral {@link CrudProvider}, so query translation and
 * value typing are reused, not repeated.
 */
export class FeatureStore {
	private readonly _crud: CrudProvider;

	constructor(crud: CrudProvider) {
		this._crud = crud;
	}

	public async list(query: FeatureListQuery): Promise<FeatureListResult> {
		const filters: FilterNode[] = [];
		if (query.search) {
			filters.push({ kind: 'condition', field: 'Code', op: 'contains', value: query.search });
		}
		if (query.source) {
			filters.push(equals('Source', query.source));
		}
		if (query.enabledForCurrentUser !== undefined) {
			filters.push(equals('StateForCurrentUser', query.enabledForCurrentUser));
		}
		// The executor ignores aggregations (a COUNT returns one empty row per feature), so ask
		// for one extra row to learn whether another page exists instead of a total.
		const { items } = await this._crud.read({
			entity: CATALOG_ENTITY,
			columns: CATALOG_COLUMNS,
			...(filters.length ? { filter: { kind: 'group', logic: 'and', items: filters } } : {}),
			order: [{ field: 'Code', dir: 'asc' }],
			top: query.top + 1,
			...(query.skip ? { skip: query.skip } : {}),
		});
		return {
			items: (items as Row[]).slice(0, query.top).map(toFeatureInfo),
			hasMore: items.length > query.top,
		};
	}

	/** The feature as Creatio resolves it, from any source. */
	public async findByCode(code: string): Promise<FeatureInfo | undefined> {
		const { items } = await this._crud.read({
			entity: CATALOG_ENTITY,
			columns: CATALOG_COLUMNS,
			filter: equals('Code', code),
			top: 1,
		});
		const row = items[0] as Row | undefined;
		return row ? toFeatureInfo(row) : undefined;
	}

	public async featureRow(code: string): Promise<FeatureRow | undefined> {
		const { items } = await this._crud.read({
			entity: FEATURE_TABLE,
			columns: ['Id', 'DefaultState'],
			filter: equals('Code', code),
			top: 1,
		});
		const row = items[0] as Row | undefined;
		return row
			? { id: String(row.Id), enabledByDefault: Number(row.DefaultState) === ENABLED }
			: undefined;
	}

	public async overrides(code: string): Promise<OverrideRecord[]> {
		const { items } = await this._crud.read({
			entity: OVERRIDE_TABLE,
			columns: ['Id', 'SysAdminUnit', 'FeatureState'],
			filter: equals('Feature.Code', code),
		});
		return (items as Row[]).map(toOverrideRecord);
	}

	/** Creates the `Feature` row for a feature that has none yet; returns its id. From then on the
	 *  DB row is the feature's source and takes precedence (the platform behaves the same). */
	public async createFeature(info: FeatureInfo, enabledByDefault: boolean): Promise<string> {
		const id = randomUUID();
		await this._crud.create({
			entity: FEATURE_TABLE,
			data: {
				Id: id,
				Code: info.code,
				Name: info.name || info.code,
				...(info.description ? { Description: info.description } : {}),
				DefaultState: toState(enabledByDefault),
			},
		});
		return id;
	}

	public async setDefault(featureId: string, enabled: boolean): Promise<void> {
		await this._crud.update({
			entity: FEATURE_TABLE,
			id: featureId,
			data: { DefaultState: toState(enabled) },
		});
	}

	public async addOverride(
		featureId: string,
		adminUnitId: string,
		enabled: boolean,
	): Promise<void> {
		await this._crud.create({
			entity: OVERRIDE_TABLE,
			data: {
				Id: randomUUID(),
				FeatureId: featureId,
				SysAdminUnitId: adminUnitId,
				FeatureState: toState(enabled),
			},
		});
	}

	public async updateOverride(overrideId: string, enabled: boolean): Promise<void> {
		await this._crud.update({
			entity: OVERRIDE_TABLE,
			id: overrideId,
			data: { FeatureState: toState(enabled) },
		});
	}

	public async removeOverride(overrideId: string): Promise<void> {
		await this._crud.delete({ entity: OVERRIDE_TABLE, id: overrideId });
	}
}
