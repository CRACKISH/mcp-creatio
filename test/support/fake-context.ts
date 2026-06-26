import { vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';

export function makeFakeAuthProvider(type: AuthProviderType = AuthProviderType.Legacy) {
	return {
		type,
		async getHeaders() {
			return {};
		},
		async refresh() {
			/* noop */
		},
		async revoke() {
			/* noop */
		},
		async getAuthorizeUrl() {
			return 'https://id.local/authorize';
		},
		async finishAuthorization() {
			/* noop */
		},
		cancelAllRefresh() {
			/* noop */
		},
	};
}

/**
 * A fake CreatioProviderContext whose providers are vi.fn() stubs returning canned
 * data. Engines are pure pass-throughs, so this drives the real engine + Server
 * handler wiring without any network.
 */
export function makeFakeContext(authType: AuthProviderType = AuthProviderType.Legacy) {
	return {
		authProvider: makeFakeAuthProvider(authType),
		crud: {
			kind: 'crud',
			listEntitySets: vi.fn().mockResolvedValue(['Contact', 'Account']),
			describeEntity: vi
				.fn()
				.mockResolvedValue({ entitySet: 'Contact', entityType: 'Contact', key: ['Id'], properties: [] }),
			read: vi.fn().mockResolvedValue([{ Id: '1' }]),
			create: vi.fn().mockResolvedValue({ id: 'new-id' }),
			update: vi.fn().mockResolvedValue('updated'),
			delete: vi.fn().mockResolvedValue('deleted'),
		},
		user: {
			kind: 'user',
			getCurrentUserInfo: vi.fn().mockResolvedValue({ contactId: 'c-1' }),
		},
		sysSettings: {
			kind: 'sys-settings',
			queryValues: vi.fn().mockResolvedValue({ success: true, values: { A: 1 } }),
			setValues: vi.fn().mockResolvedValue('ok'),
			createSetting: vi.fn().mockResolvedValue({ insertResult: { success: true } }),
			updateDefinition: vi.fn().mockResolvedValue({ success: true }),
		},
		process: {
			kind: 'process',
			executeProcess: vi.fn().mockResolvedValue({ result: 42 }),
		},
		feature: {
			kind: 'feature',
			clearFeaturesCache: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
		},
		adminOperation: {
			kind: 'admin-operation',
			upsertAdminOperation: vi.fn().mockResolvedValue({ success: true, id: 'op-1' }),
			deleteAdminOperation: vi.fn().mockResolvedValue({ success: true }),
			setAdminOperationGrantee: vi.fn().mockResolvedValue({ success: true }),
			deleteAdminOperationGrantee: vi.fn().mockResolvedValue({ success: true }),
		},
		configuration: {
			kind: 'configuration',
			call: vi.fn().mockResolvedValue({ status: 200, body: { ok: true } }),
		},
	};
}
