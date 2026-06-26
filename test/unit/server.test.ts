import { describe, expect, it } from 'vitest';

import { CreatioEngineManager } from '../../src/creatio';
import { Server } from '../../src/server/mcp';
import { makeFakeContext } from '../support/fake-context';

const GUID = '11111111-1111-1111-1111-111111111111';

type ToolHandler = (payload: unknown) => Promise<{ content: { type: string; text: string }[] }>;

function buildServer(readonlyMode = false) {
	const context = makeFakeContext();
	const engines = new CreatioEngineManager(context as never);
	const server = new Server(engines, { readonlyMode });
	const handlers = (server as unknown as { _handlers: Map<string, ToolHandler> })._handlers;
	return { server, engines, context, handlers };
}

async function callTool(handlers: Map<string, ToolHandler>, name: string, payload: unknown) {
	const handler = handlers.get(name);
	if (!handler) {
		throw new Error(`tool not registered: ${name}`);
	}
	return handler(payload);
}

function expectTextResult(result: { content: { type: string; text: string }[] }) {
	expect(result.content[0]?.type).toBe('text');
	return result.content[0]!.text;
}

describe('Server tool registration', () => {
	it('registers read + write tools when not readonly', () => {
		const { handlers } = buildServer(false);
		for (const name of [
			'get-current-user-info',
			'list-entities',
			'describe-entity',
			'read',
			'query-sys-settings',
			'create',
			'update',
			'delete',
			'execute-process',
			'set-sys-settings-value',
			'create-sys-setting',
			'update-sys-setting-definition',
			'refresh-feature-cache',
			'upsert-admin-operation',
			'delete-admin-operation',
			'set-admin-operation-grantee',
			'delete-admin-operation-grantee',
			'call-configuration-service',
		]) {
			expect(handlers.has(name)).toBe(true);
		}
	});

	it('omits write tools in readonly mode', () => {
		const { handlers } = buildServer(true);
		expect(handlers.has('read')).toBe(true);
		expect(handlers.has('get-current-user-info')).toBe(true);
		for (const name of ['create', 'update', 'delete', 'execute-process', 'upsert-admin-operation']) {
			expect(handlers.has(name)).toBe(false);
		}
	});
});

describe('Server tool handlers (read path)', () => {
	it('get-current-user-info delegates to the user provider', async () => {
		const { handlers, context } = buildServer();
		// The raw handler returns the provider result as-is; MCP content wrapping is
		// applied by _normalizeToToolHandler at registration time (covered separately).
		const res = await callTool(handlers, 'get-current-user-info', {});
		expect(context.user.getCurrentUserInfo).toHaveBeenCalled();
		expect(res).toEqual({ contactId: 'c-1' });
	});

	it('list-entities returns the entity set list', async () => {
		const { handlers, context } = buildServer();
		const res = await callTool(handlers, 'list-entities', {});
		expect(context.crud.listEntitySets).toHaveBeenCalled();
		expect(JSON.parse(expectTextResult(res))).toEqual({ results: ['Contact', 'Account'] });
	});

	it('describe-entity passes the entity set through', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'describe-entity', { entitySet: 'Contact' });
		expect(context.crud.describeEntity).toHaveBeenCalledWith('Contact');
	});

	it('read merges raw filter and structured filters with AND', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'read', {
			entity: 'Contact',
			filter: 'IsActive eq true',
			filters: { all: [{ field: 'Name', op: 'eq', value: 'Bob' }] },
			top: 10,
		});
		expect(context.crud.read).toHaveBeenCalledWith(
			expect.objectContaining({
				entity: 'Contact',
				filter: "(IsActive eq true) and (Name eq 'Bob')",
				top: 10,
			}),
		);
	});

	it('query-sys-settings delegates with codes', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'query-sys-settings', { sysSettingCodes: ['A', 'B'] });
		expect(context.sysSettings.queryValues).toHaveBeenCalledWith(['A', 'B']);
	});

	it('rejects invalid input via the zod schema', async () => {
		const { handlers } = buildServer();
		await expect(callTool(handlers, 'describe-entity', {})).rejects.toThrow();
	});
});

describe('Server tool handlers (write path)', () => {
	it('create / update / delete delegate to the crud provider', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'create', { entity: 'Contact', data: { Name: 'X' } });
		expect(context.crud.create).toHaveBeenCalledWith({ entity: 'Contact', data: { Name: 'X' } });
		await callTool(handlers, 'update', { entity: 'Contact', id: '1', data: { Name: 'Y' } });
		expect(context.crud.update).toHaveBeenCalledWith({ entity: 'Contact', id: '1', data: { Name: 'Y' } });
		await callTool(handlers, 'delete', { entity: 'Contact', id: '1' });
		expect(context.crud.delete).toHaveBeenCalledWith({ entity: 'Contact', id: '1' });
	});

	it('execute-process maps process name and parameters', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'execute-process', { processName: 'P', parameters: { a: 1 } });
		expect(context.process.executeProcess).toHaveBeenCalledWith({
			processName: 'P',
			parameters: { a: 1 },
		});
	});

	it('sys-settings write tools delegate', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'set-sys-settings-value', { sysSettingsValues: { A: 1 } });
		expect(context.sysSettings.setValues).toHaveBeenCalledWith({ A: 1 });
		await callTool(handlers, 'create-sys-setting', {
			definition: { code: 'C', name: 'N', valueTypeName: 'Boolean' },
			initialValue: true,
		});
		expect(context.sysSettings.createSetting).toHaveBeenCalled();
		await callTool(handlers, 'update-sys-setting-definition', {
			id: GUID,
			definition: { code: 'C', name: 'N', valueTypeName: 'Boolean' },
		});
		expect(context.sysSettings.updateDefinition).toHaveBeenCalled();
	});

	it('refresh-feature-cache delegates the optional code', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'refresh-feature-cache', { featureCode: 'F' });
		expect(context.feature.clearFeaturesCache).toHaveBeenCalledWith('F');
	});

	it('admin-operation tools delegate', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'upsert-admin-operation', { name: 'n', code: 'CanDo' });
		expect(context.adminOperation.upsertAdminOperation).toHaveBeenCalled();
		await callTool(handlers, 'delete-admin-operation', { ids: [GUID] });
		expect(context.adminOperation.deleteAdminOperation).toHaveBeenCalledWith([GUID]);
		await callTool(handlers, 'set-admin-operation-grantee', {
			adminOperationId: GUID,
			adminUnitIds: [GUID],
			canExecute: true,
		});
		expect(context.adminOperation.setAdminOperationGrantee).toHaveBeenCalled();
		await callTool(handlers, 'delete-admin-operation-grantee', { ids: [GUID] });
		expect(context.adminOperation.deleteAdminOperationGrantee).toHaveBeenCalledWith([GUID]);
	});

	it('call-configuration-service delegates service/method/httpMethod', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'call-configuration-service', {
			service: 'RightsService',
			method: 'GetCan',
			httpMethod: 'POST',
		});
		expect(context.configuration.call).toHaveBeenCalledWith(
			expect.objectContaining({ service: 'RightsService', method: 'GetCan', httpMethod: 'POST' }),
		);
	});
});

describe('Server result normalization', () => {
	it('wraps raw values and passes pre-wrapped content through', async () => {
		const { server } = buildServer();
		const normalize = (
			server as unknown as {
				_normalizeToToolHandler: (h: ToolHandler) => (a: unknown) => Promise<{
					content: { type: string; text: string }[];
				}>;
			}
		)._normalizeToToolHandler.bind(server);

		const passthrough = await normalize(
			async () => ({ content: [{ type: 'text', text: 'x' }] }) as never,
		)({});
		expect(passthrough.content[0]!.text).toBe('x');

		const objectWrapped = await normalize(async () => ({ a: 1 }) as never)({});
		expect(objectWrapped.content[0]!.type).toBe('text');
		expect(JSON.parse(objectWrapped.content[0]!.text)).toEqual({ a: 1 });

		const stringWrapped = await normalize(async () => 'hello' as never)({});
		expect(stringWrapped.content[0]!.text).toBe('hello');
	});
});

describe('Server MCP lifecycle', () => {
	it('startMcp registers tools/prompts and is idempotent; stopMcp closes', async () => {
		const { server } = buildServer();
		const mcp = await server.startMcp();
		expect(mcp).toBeTruthy();
		expect(await server.startMcp()).toBe(mcp); // idempotent
		expect(server.authProvider.type).toBeTruthy();
		await server.stopMcp();
	});
});
