import { afterEach, describe, expect, it } from 'vitest';

import { AdminOperationServiceProvider } from '../../src/creatio/services/admin-operation-service-provider';
import { ConfigurationServiceProvider } from '../../src/creatio/services/configuration-service-provider';
import { FeatureServiceProvider } from '../../src/creatio/services/feature-service-provider';
import { ProcessServiceProvider } from '../../src/creatio/services/process-service-provider';
import { SysSettingsServiceProvider } from '../../src/creatio/services/sys-settings-service-provider';
import { UserInfoProvider } from '../../src/creatio/services/user-info-provider';
import { bodyOf, jsonResponse, makeHttpClientHarness, textResponse } from '../support/http-client';

import { vi } from 'vitest';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ConfigurationServiceProvider', () => {
	it('rejects an invalid service or method name (injection guard)', async () => {
		const { client } = makeHttpClientHarness(() => jsonResponse({}));
		const provider = new ConfigurationServiceProvider(client);
		await expect(
			provider.call({ service: 'bad name', method: 'M' } as never),
		).rejects.toThrow(/invalid_service_name/);
		await expect(
			provider.call({ service: 'Svc', method: 'bad/method' } as never),
		).rejects.toThrow(/invalid_method_name/);
	});

	it('builds the rest URL with a query string and a JSON body for POST', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ ok: true }));
		const provider = new ConfigurationServiceProvider(client);
		const res = await provider.call({
			service: 'MyService',
			method: 'DoIt',
			httpMethod: 'POST',
			body: { a: 1 },
			query: { p: 'v', n: 2 },
		} as never);
		expect(calls[0].url).toBe(
			'https://tenant.creatio.local/0/rest/MyService/DoIt?p=v&n=2',
		);
		expect(calls[0].init.method).toBe('POST');
		expect(bodyOf(calls[0])).toEqual({ a: 1 });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});

	it('omits the body for GET and returns raw text for non-JSON responses', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse('plain-result'));
		const provider = new ConfigurationServiceProvider(client);
		const res = await provider.call({
			service: 'MyService',
			method: 'Read',
			httpMethod: 'GET',
		} as never);
		expect(calls[0].init.method).toBe('GET');
		expect(calls[0].init.body).toBeUndefined();
		expect(res.body).toBe('plain-result');
	});
});

describe('ProcessServiceProvider', () => {
	it('posts RunProcess with mapped parameter values', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ result: 'ok' }));
		const provider = new ProcessServiceProvider(client);
		await provider.executeProcess({ processName: 'MyProcess', parameters: { x: 1, y: 'z' } });
		expect(calls[0].url).toContain(
			'/0/ServiceModel/ProcessEngineService.svc/RunProcess',
		);
		const body = bodyOf(calls[0]) as { schemaName: string; parameterValues: unknown[] };
		expect(body.schemaName).toBe('MyProcess');
		expect(body.parameterValues).toEqual([
			{ name: 'x', value: 1 },
			{ name: 'y', value: 'z' },
		]);
	});
});

describe('UserInfoProvider', () => {
	it('posts to GetCurrentUserInfo and returns the parsed body', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ Id: 'u-1' }));
		const provider = new UserInfoProvider(client);
		const res = await provider.getCurrentUserInfo();
		expect(calls[0].url).toContain(
			'/0/ServiceModel/UserInfoService.svc/GetCurrentUserInfo',
		);
		expect(res).toEqual({ Id: 'u-1' });
	});
});

describe('FeatureServiceProvider', () => {
	it('clears the whole cache with a trailing slash', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse('done'));
		const provider = new FeatureServiceProvider(client);
		const res = await provider.clearFeaturesCache();
		expect(calls[0].url).toMatch(/\/ClearFeaturesCacheForAllUsers\/$/);
		expect(res.success).toBe(true);
	});

	it('base64-encodes a specific feature code in the URL', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse('done'));
		const provider = new FeatureServiceProvider(client);
		const encoded = Buffer.from('MyFeature', 'utf8').toString('base64');
		const res = await provider.clearFeaturesCache('MyFeature');
		expect(calls[0].url).toContain(`/ClearFeaturesCacheForAllUsers/${encoded}`);
		expect(res.featureCode).toBe('MyFeature');
	});
});

describe('SysSettingsServiceProvider', () => {
	it('short-circuits queryValues for an empty code list (no network call)', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({}));
		const provider = new SysSettingsServiceProvider(client);
		const res = await provider.queryValues([]);
		expect(res).toEqual({ success: true, values: {} });
		expect(calls).toHaveLength(0);
	});

	it('queries settings by code collection', async () => {
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({ success: true, values: { Maintainer: 'X' } }),
		);
		const provider = new SysSettingsServiceProvider(client);
		const res = await provider.queryValues(['Maintainer']);
		expect(calls[0].url).toContain('/QuerySysSettings');
		expect(bodyOf(calls[0])).toEqual({ sysSettingsNameCollection: ['Maintainer'] });
		expect(res.values).toEqual({ Maintainer: 'X' });
	});

	it('posts values wrapped with isPersonal=false', async () => {
		const { client, calls } = makeHttpClientHarness(() => textResponse('ok'));
		const provider = new SysSettingsServiceProvider(client);
		await provider.setValues({ Maintainer: 'Y' });
		expect(calls[0].url).toContain('/PostSysSettingsValues');
		expect(bodyOf(calls[0])).toEqual({
			isPersonal: false,
			sysSettingsValues: { Maintainer: 'Y' },
		});
	});

	it('createSetting inserts only (no value call) when no initial value is given', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ success: true }));
		const provider = new SysSettingsServiceProvider(client);
		await provider.createSetting({
			definition: { code: 'C', name: 'N', valueTypeName: 'Boolean' } as never,
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('/InsertSysSettingRequest');
	});

	it('updateDefinition posts to UpdateSysSettingRequest', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ success: true }));
		const provider = new SysSettingsServiceProvider(client);
		await provider.updateDefinition({ code: 'C', name: 'N', valueTypeName: 'Boolean' } as never);
		expect(calls[0].url).toContain('/UpdateSysSettingRequest');
		expect((bodyOf(calls[0]) as { code: string }).code).toBe('C');
	});

	it('createSetting inserts then sets the initial value', async () => {
		const { client, calls } = makeHttpClientHarness((url) =>
			url.includes('InsertSysSettingRequest')
				? jsonResponse({ success: true, id: 'gen' })
				: textResponse('ok'),
		);
		const provider = new SysSettingsServiceProvider(client);
		await provider.createSetting({
			definition: { code: 'MySetting', name: 'My', valueTypeName: 'Boolean' } as never,
			initialValue: true,
		});
		expect(calls[0].url).toContain('/InsertSysSettingRequest');
		const insertBody = bodyOf(calls[0]) as { id?: string; code: string };
		expect(insertBody.id).toBeTruthy(); // generated UUID
		expect(insertBody.code).toBe('MySetting');
		expect(calls[1].url).toContain('/PostSysSettingsValues');
		expect(bodyOf(calls[1])).toEqual({
			isPersonal: false,
			sysSettingsValues: { MySetting: true },
		});
	});
});

describe('AdminOperationServiceProvider', () => {
	it('upserts an operation and unwraps the RightsService result', async () => {
		const { client, calls } = makeHttpClientHarness(() =>
			jsonResponse({ UpsertAdminOperationResult: JSON.stringify({ Success: true }) }),
		);
		const provider = new AdminOperationServiceProvider(client);
		const res = await provider.upsertAdminOperation({ name: 'Op', code: 'CanDoIt' });
		expect(calls[0].url).toContain('/0/rest/RightsService/UpsertAdminOperation');
		const body = bodyOf(calls[0]) as { recordId: string; description: string };
		expect(body.recordId).toBeTruthy();
		expect(body.description).toBe('');
		expect(res.success).toBe(true);
		expect(res.id).toBe(body.recordId);
	});

	it('throws on an unexpected RightsService envelope', async () => {
		const { client } = makeHttpClientHarness(() => jsonResponse({ wrong: 'shape' }));
		const provider = new AdminOperationServiceProvider(client);
		await expect(
			provider.deleteAdminOperation(['11111111-1111-1111-1111-111111111111']),
		).rejects.toThrow(/unexpected_response/);
	});
});
