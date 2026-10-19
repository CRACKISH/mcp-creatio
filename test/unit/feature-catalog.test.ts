import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	CrudProvider,
	DataServiceCrudProvider,
	DataValueType,
	FeatureCatalogService,
	FeatureEngine,
	FeatureProvider,
	FeatureStore,
	ReadonlyModeError,
} from '../../src/creatio';
import { bodyOf, jsonResponse, makeHttpClientHarness } from '../support/http-client';

const FEATURE_ID = '11111111-1111-1111-1111-111111111111';
const USER_UNIT = '22222222-2222-2222-2222-222222222222';
const ROLE_UNIT = '33333333-3333-3333-3333-333333333333';
const OVERRIDE_ID = '44444444-4444-4444-4444-444444444444';

afterEach(() => vi.unstubAllGlobals());

function catalogRow(overrides: Record<string, unknown> = {}) {
	return {
		Code: 'MyFeature',
		Name: 'My feature',
		Description: '',
		Source: 'web.config',
		State: false,
		StateForCurrentUser: false,
		...overrides,
	};
}

/** Collects every `columnPath` compared in a DataService Filters tree. */
function filteredPaths(node: any): string[] {
	if (!node) return [];
	if (node.leftExpression) return [node.leftExpression.columnPath];
	return Object.values(node.items ?? {}).flatMap(filteredPaths);
}

describe('FeatureStore over the real DataService provider (wire format)', () => {
	const intColumn = { dataValueType: DataValueType.Integer };
	const schemas: Record<string, unknown> = {
		Feature: {
			success: true,
			schema: {
				name: 'Feature',
				columns: { Items: { DefaultState: { name: 'DefaultState', ...intColumn } } },
			},
		},
		AdminUnitFeatureState: {
			success: true,
			schema: {
				name: 'AdminUnitFeatureState',
				columns: {
					Items: {
						Feature: { name: 'Feature', dataValueType: DataValueType.Lookup },
						SysAdminUnit: { name: 'SysAdminUnit', dataValueType: DataValueType.Lookup },
						FeatureState: { name: 'FeatureState', ...intColumn },
					},
				},
			},
		},
	};

	function harness(selectRows: unknown[] = []) {
		return makeHttpClientHarness((url, init) => {
			if (url.endsWith('/RuntimeEntitySchemaRequest')) {
				return jsonResponse(schemas[JSON.parse(String(init.body)).name]);
			}
			if (url.endsWith('/SelectQuery')) {
				return jsonResponse({ success: true, rows: selectRows });
			}
			return jsonResponse({ success: true, rowsAffected: 1 });
		});
	}

	it('lists AppFeature sorted by code, asking one extra row to report hasMore', async () => {
		const { client, calls } = harness([
			catalogRow({ StateForCurrentUser: true }),
			catalogRow({ Code: 'Next' }),
		]);
		const result = await new FeatureStore(new DataServiceCrudProvider(client)).list({
			search: 'Feat',
			source: 'web.config',
			enabledForCurrentUser: true,
			top: 1,
			skip: 20,
		});
		// Creatio cannot aggregate these virtual rows, so no COUNT query is sent.
		expect(calls).toHaveLength(1);
		const select = bodyOf(calls[0]!) as any;
		expect(select).toMatchObject({ rootSchemaName: 'AppFeature', rowCount: 2, rowsOffset: 20 });
		expect(select.columns.items.Code.orderPosition).toBe(1);
		expect(filteredPaths(select.filters).sort()).toEqual([
			'Code',
			'Source',
			'StateForCurrentUser',
		]);
		expect(result).toEqual({
			items: [
				{
					code: 'MyFeature',
					name: 'My feature',
					source: 'web.config',
					enabledByDefault: false,
					enabledForCurrentUser: true,
				},
			],
			hasMore: true,
		});
	});

	it('reads overrides from AdminUnitFeatureState by feature code', async () => {
		const { client, calls } = harness([
			{
				Id: OVERRIDE_ID,
				SysAdminUnit: { value: USER_UNIT, displayValue: 'Supervisor' },
				FeatureState: 1,
			},
		]);
		const overrides = await new FeatureStore(new DataServiceCrudProvider(client)).overrides(
			'MyFeature',
		);
		const select = bodyOf(calls[0]!) as any;
		expect(select.rootSchemaName).toBe('AdminUnitFeatureState');
		expect(filteredPaths(select.filters)).toEqual(['Feature.Code']);
		expect(overrides).toEqual([
			{ id: OVERRIDE_ID, adminUnitId: USER_UNIT, adminUnitName: 'Supervisor', enabled: true },
		]);
	});

	it('writes overrides with lookups by id and the state as the platform integer', async () => {
		const { client, calls } = harness();
		await new FeatureStore(new DataServiceCrudProvider(client)).addOverride(
			FEATURE_ID,
			USER_UNIT,
			false,
		);
		const insert = bodyOf(calls.find((c) => c.url.endsWith('/InsertQuery'))!) as any;
		expect(insert.rootSchemaName).toBe('AdminUnitFeatureState');
		const items = insert.columnValues.items;
		expect(items.Feature.parameter).toEqual({
			dataValueType: DataValueType.Guid,
			value: FEATURE_ID,
		});
		expect(items.SysAdminUnit.parameter).toEqual({
			dataValueType: DataValueType.Guid,
			value: USER_UNIT,
		});
		expect(items.FeatureState.parameter).toEqual({
			dataValueType: DataValueType.Integer,
			value: 0,
		});
	});

	it('creates a Feature row with code, name and the default as an integer', async () => {
		const { client, calls } = harness();
		const id = await new FeatureStore(new DataServiceCrudProvider(client)).createFeature(
			{
				code: 'MyFeature',
				name: '',
				source: 'Metadata',
				enabledByDefault: false,
				enabledForCurrentUser: false,
			},
			true,
		);
		const insert = bodyOf(calls.find((c) => c.url.endsWith('/InsertQuery'))!) as any;
		const items = insert.columnValues.items;
		expect(insert.rootSchemaName).toBe('Feature');
		expect(items.Id.parameter.value).toBe(id);
		expect(items.Code.parameter.value).toBe('MyFeature');
		expect(items.Name.parameter.value).toBe('MyFeature'); // falls back to the code
		expect(items.DefaultState.parameter).toEqual({
			dataValueType: DataValueType.Integer,
			value: 1,
		});
	});
});

/**
 * In-memory CrudProvider emulating Creatio: AppFeature resolves a feature from its source unless a
 * `Feature` row exists (the DB wins); overrides live in AdminUnitFeatureState.
 */
function fakeCreatio(initial: { featureRow?: boolean; overrides?: any[] } = {}) {
	const source = catalogRow();
	let featureRow: { Id: string; DefaultState: number } | undefined = initial.featureRow
		? { Id: FEATURE_ID, DefaultState: 0 }
		: undefined;
	const overrides: any[] = [...(initial.overrides ?? [])];
	let known = true;
	return {
		kind: 'fake',
		capabilities: { rawFilter: false, expand: false },
		listEntitySets: vi.fn(),
		describeEntity: vi.fn(),
		read: vi.fn(async (query: any) => {
			if (query.entity === 'AppFeature') {
				if (!known) return { items: [] };
				return {
					items: [
						featureRow
							? {
									...source,
									State: featureRow.DefaultState === 1,
									Source: 'DbFeatureProvider',
								}
							: source,
					],
				};
			}
			if (query.entity === 'Feature') {
				return { items: featureRow ? [{ ...featureRow }] : [] };
			}
			return { items: overrides.map((o) => ({ ...o })) };
		}),
		create: vi.fn(async ({ entity, data }: any) => {
			if (entity === 'Feature') {
				featureRow = { Id: data.Id, DefaultState: data.DefaultState };
			} else {
				overrides.push({
					Id: data.Id,
					SysAdminUnit: { value: data.SysAdminUnitId, displayValue: 'Unit' },
					FeatureState: data.FeatureState,
				});
			}
			return { success: true };
		}),
		update: vi.fn(async ({ entity, id, data }: any) => {
			if (entity === 'Feature') {
				featureRow = { ...featureRow!, ...data };
			} else {
				Object.assign(
					overrides.find((o) => o.Id === id),
					data,
				);
			}
			return { success: true };
		}),
		delete: vi.fn(async ({ id }: any) => {
			overrides.splice(
				overrides.findIndex((o) => o.Id === id),
				1,
			);
			return { success: true };
		}),
		forget: () => {
			known = false;
		},
		get featureRow() {
			return featureRow;
		},
	};
}

type FakeCreatio = ReturnType<typeof fakeCreatio>;

function catalog(
	crud: FakeCreatio,
	clear: FeatureProvider['clearFeaturesCache'] = vi.fn(async () => ({
		success: true,
		message: '',
	})),
) {
	const cache: FeatureProvider = { kind: 'cache', clearFeaturesCache: clear };
	return {
		service: new FeatureCatalogService(
			new FeatureStore(crud as unknown as CrudProvider),
			cache,
		),
		clear,
	};
}

const userOverride = (state: number) => ({
	Id: OVERRIDE_ID,
	SysAdminUnit: { value: USER_UNIT, displayValue: 'Supervisor' },
	FeatureState: state,
});

describe('FeatureCatalogService', () => {
	it('getFeature returns the resolved feature with its overrides, without internal ids', async () => {
		const { service } = catalog(
			fakeCreatio({ featureRow: true, overrides: [userOverride(1)] }),
		);
		expect(await service.getFeature('MyFeature')).toEqual({
			code: 'MyFeature',
			name: 'My feature',
			source: 'DbFeatureProvider',
			enabledByDefault: false,
			enabledForCurrentUser: false,
			overrides: [{ adminUnitId: USER_UNIT, adminUnitName: 'Supervisor', enabled: true }],
		});
	});

	it('getFeature fails clearly for an unknown code', async () => {
		const crud = fakeCreatio();
		crud.forget();
		await expect(catalog(crud).service.getFeature('Nope')).rejects.toThrow(
			'feature_not_found:Nope',
		);
	});

	it('default of a web.config feature: creates its Feature row, clears the cache, re-reads', async () => {
		const crud = fakeCreatio();
		const { service, clear } = catalog(crud);
		const result = await service.setFeatureState({ code: 'MyFeature', state: 'enabled' });
		expect(crud.create).toHaveBeenCalledWith({
			entity: 'Feature',
			data: expect.objectContaining({ Code: 'MyFeature', DefaultState: 1 }),
		});
		expect(clear).toHaveBeenCalledWith('MyFeature');
		expect(result).toMatchObject({
			enabledByDefault: true,
			source: 'DbFeatureProvider',
			cacheCleared: true,
		});
	});

	it('default of a DB feature: updates the row only when it differs', async () => {
		const crud = fakeCreatio({ featureRow: true });
		const { service } = catalog(crud);
		await service.setFeatureState({ code: 'MyFeature', state: 'disabled' });
		expect(crud.update).not.toHaveBeenCalled();
		await service.setFeatureState({ code: 'MyFeature', state: 'enabled' });
		expect(crud.update).toHaveBeenCalledWith({
			entity: 'Feature',
			id: FEATURE_ID,
			data: { DefaultState: 1 },
		});
	});

	it('an override on a non-DB feature creates its row with the CURRENT default first', async () => {
		const crud = fakeCreatio();
		const result = await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'enabled',
			adminUnitId: ROLE_UNIT,
		});
		expect(crud.featureRow?.DefaultState).toBe(0); // the override did not change the default
		expect(crud.create).toHaveBeenLastCalledWith({
			entity: 'AdminUnitFeatureState',
			data: expect.objectContaining({
				FeatureId: crud.featureRow!.Id,
				SysAdminUnitId: ROLE_UNIT,
				FeatureState: 1,
			}),
		});
		expect(result.overrides).toEqual([
			{ adminUnitId: ROLE_UNIT, adminUnitName: 'Unit', enabled: true },
		]);
	});

	it('updates an existing override instead of duplicating it (GUID case-insensitive)', async () => {
		const crud = fakeCreatio({ featureRow: true, overrides: [userOverride(1)] });
		await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'disabled',
			adminUnitId: USER_UNIT.toUpperCase(),
		});
		expect(crud.create).not.toHaveBeenCalled();
		expect(crud.update).toHaveBeenCalledWith({
			entity: 'AdminUnitFeatureState',
			id: OVERRIDE_ID,
			data: { FeatureState: 0 },
		});
	});

	it('does not write when the override already has the requested state', async () => {
		const crud = fakeCreatio({ featureRow: true, overrides: [userOverride(1)] });
		await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'enabled',
			adminUnitId: USER_UNIT,
		});
		expect(crud.create).not.toHaveBeenCalled();
		expect(crud.update).not.toHaveBeenCalled();
	});

	it('inherit removes the override, and is a no-op when there is none', async () => {
		const crud = fakeCreatio({ featureRow: true, overrides: [userOverride(1)] });
		const { service } = catalog(crud);
		const result = await service.setFeatureState({
			code: 'MyFeature',
			state: 'inherit',
			adminUnitId: USER_UNIT,
		});
		expect(crud.delete).toHaveBeenCalledWith({
			entity: 'AdminUnitFeatureState',
			id: OVERRIDE_ID,
		});
		expect(result.overrides).toEqual([]);
		await service.setFeatureState({
			code: 'MyFeature',
			state: 'inherit',
			adminUnitId: USER_UNIT,
		});
		expect(crud.delete).toHaveBeenCalledTimes(1);
	});

	it('rejects inherit without an admin unit before touching Creatio', async () => {
		const crud = fakeCreatio();
		await expect(
			catalog(crud).service.setFeatureState({ code: 'MyFeature', state: 'inherit' }),
		).rejects.toThrow('feature_inherit_requires_admin_unit');
		expect(crud.read).not.toHaveBeenCalled();
	});

	it('reports a failed cache clear instead of failing an already-saved change', async () => {
		const crud = fakeCreatio({ featureRow: true });
		const clear = vi.fn(async () => {
			throw new Error('creatio_clear_features_cache_failed:400');
		});
		const result = await catalog(crud, clear).service.setFeatureState({
			code: 'MyFeature',
			state: 'enabled',
		});
		expect(result).toMatchObject({ enabledByDefault: true, cacheCleared: false });
	});

	it('fails instead of reporting success when Creatio did not save the change', async () => {
		const crud = fakeCreatio({ featureRow: true });
		crud.update.mockResolvedValueOnce({ success: true }); // "succeeds" without persisting
		await expect(
			catalog(crud).service.setFeatureState({ code: 'MyFeature', state: 'enabled' }),
		).rejects.toThrow('feature_state_not_applied:MyFeature');
	});
});

describe('FeatureEngine', () => {
	const cache: FeatureProvider = {
		kind: 'cache',
		clearFeaturesCache: vi.fn(async () => ({ success: true, message: '' })),
	};

	it('reports the catalog as unavailable without one (OData backend)', async () => {
		const engine = new FeatureEngine(cache);
		expect(engine.hasCatalog).toBe(false);
		await expect(engine.getFeature('X')).rejects.toThrow('feature_catalog_unavailable');
	});

	it('blocks set-feature-state in readonly mode before reaching the catalog', async () => {
		const crud = fakeCreatio();
		const engine = new FeatureEngine(cache, catalog(crud).service, {
			readonly: true,
			audit: vi.fn(),
		});
		expect(engine.hasCatalog).toBe(true);
		await expect(
			engine.setFeatureState({ code: 'MyFeature', state: 'enabled' }),
		).rejects.toBeInstanceOf(ReadonlyModeError);
		expect(crud.read).not.toHaveBeenCalled();
	});

	it('audits a state change', async () => {
		const audit = vi.fn();
		const engine = new FeatureEngine(cache, catalog(fakeCreatio()).service, {
			readonly: false,
			audit,
		});
		await engine.setFeatureState({ code: 'MyFeature', state: 'enabled' });
		expect(audit).toHaveBeenCalledWith('feature.set-state', {
			code: 'MyFeature',
			state: 'enabled',
			adminUnitId: null,
		});
	});
});
