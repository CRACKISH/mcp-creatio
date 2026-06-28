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

	it('does not register DataForge tools before preparation', () => {
		const { handlers } = buildServer(false);
		for (const name of [
			'dataforge-similar-tables',
			'dataforge-table-details',
			'dataforge-table-relationships',
			'dataforge-lookup-values',
			'dataforge-status',
		]) {
			expect(handlers.has(name)).toBe(false);
		}
	});

	it('omits write tools in readonly mode', () => {
		const { handlers } = buildServer(true);
		expect(handlers.has('read')).toBe(true);
		expect(handlers.has('get-current-user-info')).toBe(true);
		for (const name of [
			'create',
			'update',
			'delete',
			'execute-process',
			'upsert-admin-operation',
		]) {
			expect(handlers.has(name)).toBe(false);
		}
	});

	it('every engine exposes its provider kind', () => {
		const { engines } = buildServer();
		expect(engines.crud.kind).toBe('crud');
		expect(engines.user.kind).toBe('user');
		expect(engines.process.kind).toBe('process');
		expect(engines.sysSettings.kind).toBe('sys-settings');
		expect(engines.feature.kind).toBe('feature');
		expect(engines.adminOperation.kind).toBe('admin-operation');
		expect(engines.configuration.kind).toBe('configuration');
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
		// Raw handler returns domain data; MCP content wrapping is applied at registration.
		expect(res).toEqual({ results: ['Contact', 'Account'] });
	});

	it('describe-entity passes the entity set through', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'describe-entity', { entitySet: 'Contact' });
		expect(context.crud.describeEntity).toHaveBeenCalledWith('Contact');
	});

	it('compiles structured filters to a FilterNode and carries raw $filter as an OData extra', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'read', {
			entity: 'Contact',
			filter: 'IsActive eq true',
			filters: { all: [{ field: 'Name', op: 'eq', value: 'Bob' }] },
			top: 10,
		});
		// The neutral ReadQuery carries the structured filter as an AST; the raw OData string
		// is an OData-only escape hatch. AND-merging the two is the OData translator's job.
		expect(context.crud.read).toHaveBeenCalledWith(
			expect.objectContaining({
				entity: 'Contact',
				top: 10,
				odata: { rawFilter: 'IsActive eq true' },
				filter: {
					kind: 'group',
					logic: 'and',
					items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
				},
			}),
		);
	});

	it('applies the default top (50) when omitted', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'read', { entity: 'Contact' });
		expect(context.crud.read).toHaveBeenCalledWith(expect.objectContaining({ top: 50 }));
	});

	it('respects an explicit top:0 (count-only) and passes skip/count through', async () => {
		const { handlers, context } = buildServer();
		await callTool(handlers, 'read', {
			entity: 'Opportunity',
			filters: { all: [{ field: 'ContactId', op: 'eq', value: GUID }] },
			count: true,
			top: 0,
			skip: 25,
		});
		expect(context.crud.read).toHaveBeenCalledWith(
			expect.objectContaining({
				entity: 'Opportunity',
				top: 0,
				skip: 25,
				count: true,
				// The lookup-nav rewrite (ContactId -> Contact/Id) is an OData-dialect concern
				// applied by the translator, not at this neutral layer.
				filter: {
					kind: 'group',
					logic: 'and',
					items: [{ kind: 'condition', field: 'ContactId', op: 'eq', value: GUID }],
				},
			}),
		);
	});

	it('omits OData-only read params (filter/expand) when the backend lacks the capability', async () => {
		const context = makeFakeContext();
		// A DataService-like backend: no raw $filter, no $expand.
		(context.crud as { capabilities: unknown }).capabilities = {
			rawFilter: false,
			expand: false,
		};
		const engines = new CreatioEngineManager(context as never);
		const server = new Server(engines, { readonlyMode: false });
		const handlers = (server as unknown as { _handlers: Map<string, ToolHandler> })._handlers;
		await callTool(handlers, 'read', {
			entity: 'Contact',
			filter: 'IsActive eq true', // unsupported -> stripped by the schema
			expand: ['Account'], // unsupported -> stripped by the schema
			filters: { all: [{ field: 'Name', op: 'eq', value: 'Bob' }] },
		});
		const arg = (context.crud.read as unknown as { mock: { calls: any[][] } }).mock.calls[0][0];
		expect(arg.odata).toBeUndefined();
		expect(arg.filter).toEqual({
			kind: 'group',
			logic: 'and',
			items: [{ kind: 'condition', field: 'Name', op: 'eq', value: 'Bob' }],
		});
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
		expect(context.crud.create).toHaveBeenCalledWith({
			entity: 'Contact',
			data: { Name: 'X' },
		});
		await callTool(handlers, 'update', { entity: 'Contact', id: '1', data: { Name: 'Y' } });
		expect(context.crud.update).toHaveBeenCalledWith({
			entity: 'Contact',
			id: '1',
			data: { Name: 'Y' },
		});
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
			expect.objectContaining({
				service: 'RightsService',
				method: 'GetCan',
				httpMethod: 'POST',
			}),
		);
	});
});

const DATAFORGE_TOOLS = [
	'dataforge-similar-tables',
	'dataforge-table-details',
	'dataforge-table-relationships',
	'dataforge-lookup-values',
	'dataforge-status',
];

type ServerContext = ReturnType<typeof buildServer>['context'];

function enableDataForge(context: ServerContext) {
	context.sysSettings.queryValues.mockResolvedValue({
		success: true,
		values: { DataForgeServiceUrl: 'https://data-forge.local/' },
	});
}

function enableGlobalSearch(context: ServerContext) {
	context.sysSettings.queryValues.mockResolvedValue({
		success: true,
		values: { GlobalSearchUrl: 'http://elastic.local:9200/gs' },
	});
}

async function prepare(server: ReturnType<typeof buildServer>['server']) {
	await (server as unknown as { _prepareTools: () => Promise<void> })._prepareTools();
}

describe('DataForge tool preparation', () => {
	it('registers DataForge tools only after a successful probe', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		for (const name of DATAFORGE_TOOLS) {
			expect(handlers.has(name)).toBe(true);
		}
		expect(context.sysSettings.queryValues).toHaveBeenCalledWith(['DataForgeServiceUrl']);
	});

	it('keeps DataForge tools unregistered when the service URL is empty', async () => {
		const { server, handlers } = buildServer();
		await prepare(server); // default fake has no DataForgeServiceUrl
		for (const name of DATAFORGE_TOOLS) {
			expect(handlers.has(name)).toBe(false);
		}
	});

	it('registers DataForge read tools even in readonly mode', async () => {
		const { server, context, handlers } = buildServer(true);
		enableDataForge(context);
		await prepare(server);
		expect(handlers.has('dataforge-similar-tables')).toBe(true);
		expect(handlers.has('create')).toBe(false);
	});

	it('similar-tables tool wraps the query under request for the read service', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		await callTool(handlers, 'dataforge-similar-tables', { query: 'tickets', limit: 5 });
		expect(context.configuration.call).toHaveBeenCalledWith(
			expect.objectContaining({
				service: 'DataForgeSchemaReadService',
				method: 'GetSimilarTableNames',
				httpMethod: 'POST',
				body: { request: { query: 'tickets', limit: 5 } },
			}),
		);
	});

	it('every read tool maps to its DataForge service method', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		await callTool(handlers, 'dataforge-table-details', { query: 'orders' });
		await callTool(handlers, 'dataforge-table-relationships', {
			sourceTable: 'Contact',
			targetTable: 'Account',
		});
		await callTool(handlers, 'dataforge-lookup-values', { query: 'vip' });
		const methods = context.configuration.call.mock.calls.map((c: any[]) => c[0].method);
		expect(methods).toEqual(
			expect.arrayContaining(['GetTableDetails', 'GetTableRelationships', 'GetLookupValues']),
		);
	});

	it('status tool calls the maintenance service', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		await callTool(handlers, 'dataforge-status', {});
		expect(context.configuration.call).toHaveBeenCalledWith(
			expect.objectContaining({
				service: 'DataForgeMaintenanceService',
				method: 'GetServiceStatus',
			}),
		);
	});
});

describe('Global Search tool preparation', () => {
	it('is not registered before preparation', () => {
		const { handlers } = buildServer();
		expect(handlers.has('global-search')).toBe(false);
	});

	it('registers global-search only when GlobalSearchUrl is set', async () => {
		const { server, context, handlers } = buildServer();
		enableGlobalSearch(context);
		await prepare(server);
		expect(handlers.has('global-search')).toBe(true);
		expect(context.sysSettings.queryValues).toHaveBeenCalledWith(['GlobalSearchUrl']);
	});

	it('stays unregistered when GlobalSearchUrl is empty', async () => {
		const { server, handlers } = buildServer();
		await prepare(server); // default fake has no GlobalSearchUrl
		expect(handlers.has('global-search')).toBe(false);
	});

	it('search tool posts a flat body to GlobalSearchService.Search', async () => {
		const { server, context, handlers } = buildServer();
		enableGlobalSearch(context);
		await prepare(server);
		await callTool(handlers, 'global-search', {
			query: 'andrew',
			entities: ['Contact'],
			limit: 10,
		});
		expect(context.configuration.call).toHaveBeenCalledWith(
			expect.objectContaining({
				service: 'GlobalSearchService',
				method: 'Search',
				httpMethod: 'POST',
				body: {
					queryString: 'andrew',
					sectionEntityName: '',
					recordCount: 10,
					from: 0,
					type: 'Contact',
				},
			}),
		);
	});

	it('is registered in readonly mode (read-only capability)', async () => {
		const { server, context, handlers } = buildServer(true);
		enableGlobalSearch(context);
		await prepare(server);
		expect(handlers.has('global-search')).toBe(true);
	});
});

describe('Published-tools capability (hidden, off by default)', () => {
	it('does not register any published (pub-*) tools when ENABLE_PUBLISHED_TOOLS is unset', async () => {
		const { server, handlers } = buildServer();
		await prepare(server);
		expect([...handlers.keys()].some((name) => name.startsWith('pub-'))).toBe(false);
	});
});

describe('describe-entity DataForge routing', () => {
	it('routes through DataForge when enabled', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		const res = await callTool(handlers, 'describe-entity', { entitySet: 'Contact' });
		expect((res as any).source).toBe('dataforge');
		expect(context.crud.describeEntity).not.toHaveBeenCalled();
	});

	it('falls back to OData when DataForge reports failure', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context);
		await prepare(server);
		context.configuration.call.mockResolvedValue({
			status: 200,
			body: { Success: false, ErrorInfo: { ErrorCode: 'AccessDenied' } },
		});
		const res = await callTool(handlers, 'describe-entity', { entitySet: 'Contact' });
		expect((res as any).source).toBe('odata');
		expect(context.crud.describeEntity).toHaveBeenCalledWith('Contact');
	});

	it('uses OData directly when DataForge is disabled', async () => {
		const { handlers, context } = buildServer(); // no preparation → disabled
		const res = await callTool(handlers, 'describe-entity', { entitySet: 'Contact' });
		expect((res as any).source).toBe('odata');
		expect(context.crud.describeEntity).toHaveBeenCalledWith('Contact');
		expect(context.configuration.call).not.toHaveBeenCalled();
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

	it('scrubs credential-looking values out of a tool result before relaying it', async () => {
		const { server } = buildServer();
		const normalize = (
			server as unknown as {
				_normalizeToToolHandler: (h: ToolHandler) => (a: unknown) => Promise<{
					content: { type: string; text: string }[];
				}>;
			}
		)._normalizeToToolHandler.bind(server);
		const out = await normalize(
			async () => ({ note: 'token is Bearer eyJleak.kkk.zzz', client_secret: 'sh-99' }) as never,
		)({});
		expect(out.content[0]!.text).not.toContain('eyJleak.kkk.zzz');
		expect(out.content[0]!.text).not.toContain('sh-99');
		expect(out.content[0]!.text).toContain('[REDACTED]');
	});

	it('redacts a thrown error message at the boundary while still surfacing the error', async () => {
		const { server } = buildServer();
		const normalize = (
			server as unknown as {
				_normalizeToToolHandler: (h: ToolHandler) => (a: unknown) => Promise<unknown>;
			}
		)._normalizeToToolHandler.bind(server);
		const failing = normalize(async () => {
			throw new Error('upstream 401: Authorization: Bearer eyJsecret.aaa.bbb');
		});
		await expect(failing({})).rejects.toThrow(/\[REDACTED\]/);
		await expect(failing({})).rejects.not.toThrow(/eyJsecret/);
	});
});

describe('Server MCP lifecycle', () => {
	it('createSessionServer builds an independent McpServer per session; stopAll closes', async () => {
		const { server } = buildServer();
		const a = server.createSessionServer();
		const b = server.createSessionServer();
		expect(a).toBeTruthy();
		expect(b).toBeTruthy();
		// Each session MUST get its own server — a shared singleton would reject the second
		// transport's connect() with "Already connected to a transport".
		expect(a).not.toBe(b);
		expect(server.authProvider.type).toBeTruthy();
		await server.stopAll();
	});

	it('releaseSessionServer untracks (and closes) a single session server', async () => {
		const { server } = buildServer();
		const tracked = (server as unknown as { _sessionServers: Set<unknown> })._sessionServers;
		const mcp = server.createSessionServer();
		expect(tracked.has(mcp)).toBe(true);
		server.releaseSessionServer(mcp);
		expect(tracked.has(mcp)).toBe(false);
		await server.stopAll(); // nothing left to close — must not throw
	});

	it('ensureCapabilitiesProbed runs the probe once and memoizes a complete verdict', async () => {
		const { server } = buildServer();
		const s = server as unknown as {
			_probeComplete: boolean;
			_probeInFlight: boolean;
			_capabilities: Map<string, boolean>;
		};
		server.ensureCapabilitiesProbed();
		expect(s._probeInFlight).toBe(true); // kicked off
		for (let i = 0; i < 100 && s._probeInFlight; i++) {
			await new Promise((r) => setTimeout(r, 5));
		}
		// Default fake context: every preparer returns a clean (disabled) verdict, so the probe is
		// complete and memoized — a second call is a no-op and does not re-probe.
		expect(s._probeComplete).toBe(true);
		const verdicts = s._capabilities.size;
		expect(verdicts).toBeGreaterThan(0);
		server.ensureCapabilitiesProbed();
		expect(s._probeInFlight).toBe(false);
		expect(s._capabilities.size).toBe(verdicts);
	});

	it('late capability registration pushes tools into an already-live session server', async () => {
		const { server, context, handlers } = buildServer();
		enableDataForge(context); // the probe will now succeed
		server.createSessionServer(); // a session is live BEFORE the probe runs
		await (server as unknown as { _prepareTools: () => Promise<boolean> })._prepareTools();
		// Registered into the shared maps AND pushed into the live session server (loop exercised).
		expect(handlers.has('dataforge-status')).toBe(true);
		await server.stopAll();
	});
});

describe('capability kill-switches (DISABLE_DATAFORGE / DISABLE_GLOBAL_SEARCH)', () => {
	function buildServerWith(config: Record<string, unknown>) {
		const context = makeFakeContext();
		const engines = new CreatioEngineManager(context as never);
		const server = new Server(engines, config);
		const handlers = (server as unknown as { _handlers: Map<string, ToolHandler> })._handlers;
		return { server, context, handlers };
	}

	it('disableDataForge: does NOT probe or register DataForge tools (even if it would succeed)', async () => {
		const { server, context, handlers } = buildServerWith({ disableDataForge: true });
		enableDataForge(context); // probe WOULD succeed if it ran
		await prepare(server);
		for (const name of DATAFORGE_TOOLS) {
			expect(handlers.has(name)).toBe(false);
		}
		// describe-entity must not route through DataForge, and no probe traffic is sent.
		expect((server as unknown as { _isDataForgeReady(): boolean })._isDataForgeReady()).toBe(
			false,
		);
		expect(context.sysSettings.queryValues).not.toHaveBeenCalledWith(['DataForgeServiceUrl']);
	});

	it('disableGlobalSearch: does NOT probe or register the global-search tool', async () => {
		const { server, context, handlers } = buildServerWith({ disableGlobalSearch: true });
		enableGlobalSearch(context);
		await prepare(server);
		expect(handlers.has('global-search')).toBe(false);
		expect(context.sysSettings.queryValues).not.toHaveBeenCalledWith(['GlobalSearchUrl']);
	});

	it('control: both register normally when not disabled', async () => {
		const dfx = buildServerWith({});
		enableDataForge(dfx.context);
		await prepare(dfx.server);
		expect(dfx.handlers.has('dataforge-status')).toBe(true);

		const gsx = buildServerWith({});
		enableGlobalSearch(gsx.context);
		await prepare(gsx.server);
		expect(gsx.handlers.has('global-search')).toBe(true);
	});

	it('describe-entity routes to the CRUD backend (never DataForge) when DataForge is disabled', async () => {
		const { server, context, handlers } = buildServerWith({ disableDataForge: true });
		enableDataForge(context); // DataForge WOULD be ready if it were probed
		await prepare(server);
		const res = (await callTool(handlers, 'describe-entity', { entitySet: 'Contact' })) as {
			source: string;
		};
		expect(res.source).not.toBe('dataforge'); // came from the backend, not DataForge
		expect(context.crud.describeEntity).toHaveBeenCalledWith('Contact');
	});
});
