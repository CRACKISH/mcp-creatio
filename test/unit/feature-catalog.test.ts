import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	AppFeatureStore,
	CrudProvider,
	DataServiceCrudProvider,
	DataValueType,
	FeatureCatalogService,
	FeatureEngine,
	FeatureProvider,
	ReadonlyModeError,
} from '../../src/creatio';
import { bodyOf, jsonResponse, makeHttpClientHarness } from '../support/http-client';

const FEATURE_ID = '11111111-1111-1111-1111-111111111111';
const USER_UNIT = '22222222-2222-2222-2222-222222222222';
const ROLE_UNIT = '33333333-3333-3333-3333-333333333333';
const OVERRIDE_ID = '44444444-4444-4444-4444-444444444444';

afterEach(() => vi.unstubAllGlobals());

function featureRow(overrides: Record<string, unknown> = {}) {
	return {
		Id: FEATURE_ID,
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

describe('AppFeatureStore over the real DataService provider (wire format)', () => {
	const schemas: Record<string, unknown> = {
		AppFeatureState: {
			success: true,
			schema: {
				name: 'AppFeatureState',
				columns: {
					Items: {
						Id: { name: 'Id', dataValueType: DataValueType.Guid },
						Feature: { name: 'Feature', dataValueType: DataValueType.Lookup },
						AdminUnit: { name: 'AdminUnit', dataValueType: DataValueType.Lookup },
						FeatureState: {
							name: 'FeatureState',
							dataValueType: DataValueType.Boolean,
						},
					},
				},
			},
		},
	};

	function harness(selectRows: unknown[] = []) {
		return makeHttpClientHarness((url, init) => {
			if (url.endsWith('/RuntimeEntitySchemaRequest')) {
				const { name } = JSON.parse(String(init.body));
				return jsonResponse(schemas[name]);
			}
			if (url.endsWith('/SelectQuery')) {
				return jsonResponse({ success: true, rows: selectRows });
			}
			return jsonResponse({ success: true, rowsAffected: 1 });
		});
	}

	it('list queries AppFeature sorted by code, asking one extra row to report hasMore', async () => {
		const rows = [featureRow({ StateForCurrentUser: true }), featureRow({ Code: 'Next' })];
		const { client, calls } = harness(rows);
		const store = new AppFeatureStore(new DataServiceCrudProvider(client));
		const result = await store.list({
			search: 'Feat',
			source: 'web.config',
			enabledForCurrentUser: true,
			top: 1,
			skip: 20,
		});
		// Creatio cannot aggregate these virtual rows, so no COUNT query is sent.
		expect(calls).toHaveLength(1);
		const select = bodyOf(calls[0]!) as any;
		expect(select.rootSchemaName).toBe('AppFeature');
		expect(select.rowCount).toBe(2);
		expect(select.rowsOffset).toBe(20);
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

	it('list reports no further page when the extra row is absent', async () => {
		const { client } = harness([featureRow()]);
		const store = new AppFeatureStore(new DataServiceCrudProvider(client));
		expect((await store.list({ top: 5 })).hasMore).toBe(false);
	});

	it('overrides filter by the feature via the backward reference the executor requires', async () => {
		const { client, calls } = harness([
			{
				Id: OVERRIDE_ID,
				AdminUnit: { value: USER_UNIT, displayValue: 'Supervisor' },
				FeatureState: true,
			},
		]);
		const store = new AppFeatureStore(new DataServiceCrudProvider(client));
		const overrides = await store.overrides(FEATURE_ID);
		const select = bodyOf(calls[0]!) as any;
		expect(select.rootSchemaName).toBe('AppFeatureState');
		// The executor answers only this backward-reference filter; `Feature.Id` returns no rows.
		expect(filteredPaths(select.filters)).toEqual(['[AppFeature:Id:Feature].Id']);
		expect(overrides).toEqual([
			{ id: OVERRIDE_ID, adminUnitId: USER_UNIT, adminUnitName: 'Supervisor', enabled: true },
		]);
	});

	it('addOverride writes the lookups by id and the state as a boolean', async () => {
		const { client, calls } = harness();
		const store = new AppFeatureStore(new DataServiceCrudProvider(client));
		await store.addOverride(FEATURE_ID, USER_UNIT, true);
		const insert = bodyOf(calls.find((c) => c.url.endsWith('/InsertQuery'))!) as any;
		expect(insert.rootSchemaName).toBe('AppFeatureState');
		const items = insert.columnValues.items;
		expect(items.Feature.parameter).toEqual({
			dataValueType: DataValueType.Guid,
			value: FEATURE_ID,
		});
		expect(items.AdminUnit.parameter).toEqual({
			dataValueType: DataValueType.Guid,
			value: USER_UNIT,
		});
		expect(items.FeatureState.parameter).toEqual({
			dataValueType: DataValueType.Boolean,
			value: true,
		});
		expect(items.Id.parameter.value).toMatch(/^[0-9a-f-]{36}$/);
	});
});

/** In-memory CrudProvider emulating the AppFeature / AppFeatureState executors + listeners. */
function fakeCrud(initial: { feature?: Record<string, unknown>; overrides?: any[] } = {}) {
	let feature: Record<string, unknown> | undefined = initial.feature ?? featureRow();
	const overrides: any[] = [...(initial.overrides ?? [])];
	const crud = {
		kind: 'fake',
		capabilities: { rawFilter: false, expand: false },
		listEntitySets: vi.fn(),
		describeEntity: vi.fn(),
		read: vi.fn(async (query: any) => {
			if (query.entity === 'AppFeature') {
				return { items: feature ? [feature] : [] };
			}
			return { items: overrides.map((o) => ({ ...o })) };
		}),
		create: vi.fn(async ({ data }: any) => {
			overrides.push({
				Id: data.Id,
				AdminUnit: { value: data.AdminUnitId, displayValue: 'Unit' },
				FeatureState: data.FeatureState,
			});
			return { success: true };
		}),
		update: vi.fn(async ({ entity, id, data }: any) => {
			if (entity === 'AppFeature') {
				feature = { ...feature, State: data.State };
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
		removeFeature: () => {
			feature = undefined;
		},
	};
	return crud;
}

function catalog(crud: ReturnType<typeof fakeCrud>) {
	const cache: FeatureProvider = {
		kind: 'cache',
		clearFeaturesCache: vi.fn(async () => ({ success: true, message: '' })),
	};
	return {
		service: new FeatureCatalogService(
			new AppFeatureStore(crud as unknown as CrudProvider),
			cache,
		),
		cache,
	};
}

const userOverride = (state: boolean) => ({
	Id: OVERRIDE_ID,
	AdminUnit: { value: USER_UNIT, displayValue: 'Supervisor' },
	FeatureState: state,
});

describe('FeatureCatalogService', () => {
	it('getFeature returns the feature with its overrides, without internal ids', async () => {
		const { service } = catalog(fakeCrud({ overrides: [userOverride(true)] }));
		expect(await service.getFeature('MyFeature')).toEqual({
			code: 'MyFeature',
			name: 'My feature',
			source: 'web.config',
			enabledByDefault: false,
			enabledForCurrentUser: false,
			overrides: [{ adminUnitId: USER_UNIT, adminUnitName: 'Supervisor', enabled: true }],
		});
	});

	it('getFeature fails clearly for an unknown code', async () => {
		const crud = fakeCrud();
		crud.removeFeature();
		await expect(catalog(crud).service.getFeature('Nope')).rejects.toThrow(
			'feature_not_found:Nope',
		);
	});

	it('changes the default state, clears that feature cache, and returns the re-read feature', async () => {
		const crud = fakeCrud();
		const { service, cache } = catalog(crud);
		const result = await service.setFeatureState({ code: 'MyFeature', state: 'enabled' });
		expect(crud.update).toHaveBeenCalledWith({
			entity: 'AppFeature',
			id: FEATURE_ID,
			data: { State: true },
		});
		expect(cache.clearFeaturesCache).toHaveBeenCalledWith('MyFeature');
		expect(result.enabledByDefault).toBe(true);
	});

	it('adds an override for a user/role that has none', async () => {
		const crud = fakeCrud();
		const result = await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'enabled',
			adminUnitId: ROLE_UNIT,
		});
		expect(crud.create).toHaveBeenCalledWith({
			entity: 'AppFeatureState',
			data: expect.objectContaining({
				FeatureId: FEATURE_ID,
				AdminUnitId: ROLE_UNIT,
				FeatureState: true,
			}),
		});
		expect(result.overrides).toEqual([
			{ adminUnitId: ROLE_UNIT, adminUnitName: 'Unit', enabled: true },
		]);
	});

	it('updates an existing override instead of duplicating it (GUID case-insensitive)', async () => {
		const crud = fakeCrud({ overrides: [userOverride(true)] });
		await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'disabled',
			adminUnitId: USER_UNIT.toUpperCase(),
		});
		expect(crud.create).not.toHaveBeenCalled();
		expect(crud.update).toHaveBeenCalledWith({
			entity: 'AppFeatureState',
			id: OVERRIDE_ID,
			data: { FeatureState: false },
		});
	});

	it('does not write when the override already has the requested state', async () => {
		const crud = fakeCrud({ overrides: [userOverride(true)] });
		await catalog(crud).service.setFeatureState({
			code: 'MyFeature',
			state: 'enabled',
			adminUnitId: USER_UNIT,
		});
		expect(crud.create).not.toHaveBeenCalled();
		expect(crud.update).not.toHaveBeenCalled();
	});

	it('inherit removes the override, and is a no-op when there is none', async () => {
		const crud = fakeCrud({ overrides: [userOverride(true)] });
		const { service } = catalog(crud);
		const result = await service.setFeatureState({
			code: 'MyFeature',
			state: 'inherit',
			adminUnitId: USER_UNIT,
		});
		expect(crud.delete).toHaveBeenCalledWith({ entity: 'AppFeatureState', id: OVERRIDE_ID });
		expect(result.overrides).toEqual([]);
		await service.setFeatureState({
			code: 'MyFeature',
			state: 'inherit',
			adminUnitId: USER_UNIT,
		});
		expect(crud.delete).toHaveBeenCalledTimes(1);
	});

	it('rejects inherit without an admin unit before touching Creatio', async () => {
		const crud = fakeCrud();
		await expect(
			catalog(crud).service.setFeatureState({ code: 'MyFeature', state: 'inherit' }),
		).rejects.toThrow('feature_inherit_requires_admin_unit');
		expect(crud.read).not.toHaveBeenCalled();
	});

	it('fails instead of reporting success when Creatio did not apply the change', async () => {
		const crud = fakeCrud();
		crud.update.mockResolvedValueOnce({ success: true }); // write "succeeds" but state stays off
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
		const crud = fakeCrud();
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
		const engine = new FeatureEngine(cache, catalog(fakeCrud()).service, {
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
