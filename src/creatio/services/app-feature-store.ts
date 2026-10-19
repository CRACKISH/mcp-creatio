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

// The virtual entities behind the Freedom UI feature page (package `FeatureToggling`). Their
// query executors list features from EVERY source (web.config, metadata, …), and their save/delete
// listeners write the persisted `Feature` / `AdminUnitFeatureState` rows, so going through them
// keeps the platform's own rules instead of re-implementing them. DataService-only.
const FEATURE_ENTITY = 'AppFeature';
const OVERRIDE_ENTITY = 'AppFeatureState';
const FEATURE_COLUMNS = [
	'Id',
	'Code',
	'Name',
	'Description',
	'Source',
	'State',
	'StateForCurrentUser',
];
const OVERRIDE_COLUMNS = ['Id', 'AdminUnit', 'FeatureState'];
// The AppFeatureState executor answers ONLY this backward-reference filter (or its own `Id`);
// `Feature` / `Feature.Id` silently return no rows (verified live).
const OVERRIDES_BY_FEATURE_PATH = '[AppFeature:Id:Feature].Id';

export interface FeatureRecord extends FeatureInfo {
	/** Row id. For a feature without a DB row Creatio issues a temporary, per-session id, so
	 *  callers must re-read it right before writing rather than keep it around. */
	id: string;
}

export interface OverrideRecord extends FeatureOverride {
	id: string;
}

type Row = Record<string, unknown>;

const text = (cell: unknown): string => (cell == null ? '' : String(cell));

/** Rows come normalized by the provider: a lookup is a {@link LookupValue} or `null`. */
const lookup = (cell: unknown): LookupValue | null => (cell as LookupValue | null) ?? null;

function toFeatureRecord(row: Row): FeatureRecord {
	const description = text(row.Description);
	return {
		id: String(row.Id),
		code: String(row.Code),
		name: text(row.Name),
		...(description ? { description } : {}),
		source: text(row.Source),
		enabledByDefault: row.State === true,
		enabledForCurrentUser: row.StateForCurrentUser === true,
	};
}

/** Drops the row id: it is an internal handle (temporary for non-DB features), not domain data. */
export function withoutId<T extends { id: string }>({ id: _id, ...rest }: T): Omit<T, 'id'> {
	return rest;
}

function toOverrideRecord(row: Row): OverrideRecord {
	return {
		id: String(row.Id),
		adminUnitId: text(lookup(row.AdminUnit)?.value),
		adminUnitName: text(lookup(row.AdminUnit)?.displayValue),
		enabled: row.FeatureState === true,
	};
}

function and(items: FilterNode[]): FilterNode | undefined {
	return items.length ? { kind: 'group', logic: 'and', items } : undefined;
}

/**
 * Data access for feature toggles over the `AppFeature` / `AppFeatureState` virtual entities —
 * the single place that knows their column names and row shapes (Information Expert). Built on
 * the neutral {@link CrudProvider}, so query translation and value typing are reused, not repeated.
 */
export class AppFeatureStore {
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
			filters.push({ kind: 'condition', field: 'Source', op: 'eq', value: query.source });
		}
		if (query.enabledForCurrentUser !== undefined) {
			filters.push({
				kind: 'condition',
				field: 'StateForCurrentUser',
				op: 'eq',
				value: query.enabledForCurrentUser,
			});
		}
		const filter = and(filters);
		// The executor ignores aggregations (a COUNT returns one empty row per feature), so ask
		// for one extra row to learn whether another page exists instead of a total.
		const { items } = await this._crud.read({
			entity: FEATURE_ENTITY,
			columns: FEATURE_COLUMNS,
			...(filter ? { filter } : {}),
			order: [{ field: 'Code', dir: 'asc' }],
			top: query.top + 1,
			...(query.skip ? { skip: query.skip } : {}),
		});
		return {
			items: (items as Row[])
				.slice(0, query.top)
				.map((row) => withoutId(toFeatureRecord(row))),
			hasMore: items.length > query.top,
		};
	}

	public async findByCode(code: string): Promise<FeatureRecord | undefined> {
		const { items } = await this._crud.read({
			entity: FEATURE_ENTITY,
			columns: FEATURE_COLUMNS,
			filter: { kind: 'condition', field: 'Code', op: 'eq', value: code },
			top: 1,
		});
		const row = items[0] as Row | undefined;
		return row ? toFeatureRecord(row) : undefined;
	}

	public async overrides(featureId: string): Promise<OverrideRecord[]> {
		const { items } = await this._crud.read({
			entity: OVERRIDE_ENTITY,
			columns: OVERRIDE_COLUMNS,
			filter: {
				kind: 'condition',
				field: OVERRIDES_BY_FEATURE_PATH,
				op: 'eq',
				value: featureId,
			},
		});
		return (items as Row[]).map(toOverrideRecord);
	}

	public async setDefault(featureId: string, enabled: boolean): Promise<void> {
		await this._crud.update({
			entity: FEATURE_ENTITY,
			id: featureId,
			data: { State: enabled },
		});
	}

	public async addOverride(
		featureId: string,
		adminUnitId: string,
		enabled: boolean,
	): Promise<void> {
		await this._crud.create({
			entity: OVERRIDE_ENTITY,
			data: {
				Id: randomUUID(),
				FeatureId: featureId,
				AdminUnitId: adminUnitId,
				FeatureState: enabled,
			},
		});
	}

	public async updateOverride(overrideId: string, enabled: boolean): Promise<void> {
		await this._crud.update({
			entity: OVERRIDE_ENTITY,
			id: overrideId,
			data: { FeatureState: enabled },
		});
	}

	public async removeOverride(overrideId: string): Promise<void> {
		await this._crud.delete({ entity: OVERRIDE_ENTITY, id: overrideId });
	}
}
