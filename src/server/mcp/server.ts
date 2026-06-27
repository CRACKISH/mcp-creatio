import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
	CreatioEngineManager,
	ICreatioAuthProvider,
	ReadQuery,
	SysSettingDefinitionUpdate,
} from '../../creatio';
import log from '../../log';
import { envBool, withValidation } from '../../utils';
import { NAME, VERSION } from '../../version';

import { CrtMcpPublishingClient } from './crtmcp/crt-mcp-client';
import { CrtMcpPublishingToolPreparer } from './crtmcp/crt-mcp-tool-preparer';
import { DataForgeClient } from './dataforge/dataforge-client';
import { DataForgeToolPreparer } from './dataforge/dataforge-tool-preparer';
import { GlobalSearchClient } from './globalsearch/globalsearch-client';
import { GlobalSearchToolPreparer } from './globalsearch/globalsearch-tool-preparer';
import { buildFilterNode, parseOrderBy } from './filters';
import { ALL_PROMPTS } from './prompts-data';
import { ToolHandler, ToolPreparer, ToolRegistrar } from './tool-preparer';
import {
	callConfigurationServiceDescriptor,
	callConfigurationServiceInput,
	createDescriptor,
	createInput,
	createSysSettingDescriptor,
	createSysSettingInput,
	deleteAdminOperationDescriptor,
	deleteAdminOperationGranteeDescriptor,
	deleteAdminOperationGranteeInput,
	deleteAdminOperationInput,
	deleteDescriptor,
	deleteInput,
	describeEntityDescriptor,
	describeEntityInput,
	executeProcessDescriptor,
	executeProcessInput,
	getCurrentUserInfoDescriptor,
	getCurrentUserInfoInput,
	listEntitiesDescriptor,
	listEntitiesInput,
	querySysSettingsDescriptor,
	querySysSettingsInput,
	readDescriptor,
	readInput,
	refreshFeatureCacheDescriptor,
	refreshFeatureCacheInput,
	setAdminOperationGranteeDescriptor,
	setAdminOperationGranteeInput,
	setSysSettingsValueDescriptor,
	setSysSettingsValueInput,
	updateDescriptor,
	updateInput,
	updateSysSettingDefinitionDescriptor,
	updateSysSettingDefinitionInput,
	upsertAdminOperationDescriptor,
	upsertAdminOperationInput,
} from './tools-data';

/** Default page size for `read` when the caller omits `top`, so we never dump an
 *  unbounded result set into the model. Explicit `top` (incl. `0` for count-only)
 *  is always respected; paginate further with `skip`. */
const DEFAULT_READ_TOP = 50;

export interface ServerConfig {
	readonlyMode?: boolean;
}

/** A client tool as data: its name, MCP descriptor, zod input schema, and a handler that
 *  returns raw domain data (MCP content wrapping is applied centrally at registration). */
interface ClientToolDef {
	name: string;
	descriptor: any;
	input: any;
	run: (args: any) => Promise<unknown>;
}

export class Server {
	private readonly _engines: CreatioEngineManager;
	private readonly _descriptors = new Map<string, any>();
	private readonly _handlers = new Map<string, ToolHandler>();
	private _mcp?: McpServer;
	private _readonly = false;
	private _serverName = NAME;
	private _serverVersion = VERSION;
	// DataForge access layer + optional-capability preparers. `_capabilities`
	// records each preparer's startup verdict so core tools (describe-entity)
	// can route through a capability only when it is actually enabled.
	private readonly _dataForge: DataForgeClient;
	private readonly _dataForgePreparer: DataForgeToolPreparer;
	private readonly _globalSearchPreparer: GlobalSearchToolPreparer;
	private readonly _publishedToolsPreparer: CrtMcpPublishingToolPreparer;
	private readonly _preparers: ToolPreparer[];
	private readonly _capabilities = new Map<string, boolean>();

	public get authProvider(): ICreatioAuthProvider {
		return this._engines.authProvider;
	}

	constructor(engines: CreatioEngineManager, config: ServerConfig) {
		this._engines = engines;
		this._readonly = config.readonlyMode ?? false;
		this._dataForge = new DataForgeClient(engines.configuration, engines.sysSettings);
		this._dataForgePreparer = new DataForgeToolPreparer(this._dataForge);
		this._globalSearchPreparer = new GlobalSearchToolPreparer(
			new GlobalSearchClient(engines.configuration, engines.sysSettings),
		);
		this._publishedToolsPreparer = new CrtMcpPublishingToolPreparer(
			new CrtMcpPublishingClient(engines.configuration, engines.crud),
			envBool('ENABLE_PUBLISHED_TOOLS', false),
		);
		this._preparers = [
			this._dataForgePreparer,
			this._globalSearchPreparer,
			this._publishedToolsPreparer,
		];
		this._registerClientTools();
	}

	private _registerData() {
		for (const [name, handler] of this._handlers.entries()) {
			this._registerAsTool(name, handler);
		}
		this._registerPrompts();
	}

	private _registerHandlerWithDescriptor(name: string, descriptor: any, handler: ToolHandler) {
		this._handlers.set(name, handler);
		this._descriptors.set(name, descriptor);
		if (this._mcp) {
			this._registerAsTool(name, handler);
		}
	}

	private _normalizeToToolHandler(handler: ToolHandler) {
		return async (args: any) => {
			const result = await handler(args);
			// Pass through only a genuine MCP envelope (`content` is an array of blocks) — e.g.
			// the published-tools proxy returns an upstream tools/call result already shaped.
			// Raw domain data (incl. server payloads that happen to have a scalar/object
			// `content` field) is stringified, never mistaken for a pre-wrapped result.
			if (
				result &&
				typeof result === 'object' &&
				Array.isArray((result as { content?: unknown }).content)
			) {
				return result;
			}
			return {
				content: [
					{
						type: 'text',
						text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
					},
				],
			};
		};
	}

	private _registerAsTool(name: string, handler: ToolHandler) {
		if (!this._mcp) {
			return;
		}
		try {
			const descriptor =
				this._descriptors.get(name) ||
				({
					title: name,
					description: `Tool ${name}`,
					inputSchema: {},
				} as any);
			this._mcp.registerTool(name, descriptor, async (args: any) => {
				return this._normalizeToToolHandler(handler)(args);
			});
			log.info('mcp.tool.register', { tool: name });
		} catch (err) {
			log.warn('mcp.tool.register.failed', { tool: name, error: String(err) });
		}
	}

	private _registerPrompts() {
		if (!this._mcp) {
			return;
		}
		try {
			for (const prompt of ALL_PROMPTS) {
				this._mcp.registerPrompt(
					prompt.name,
					{
						title: prompt.title,
						description: prompt.description,
						argsSchema: prompt.argsSchema,
					},
					prompt.callback,
				);
				log.info('mcp.prompt.register', { prompt: prompt.name });
			}
		} catch (err) {
			log.warn('mcp.prompts.register.failed', { error: String(err) });
		}
	}

	/** Adapter exposing handler registration to {@link ToolPreparer}s. */
	private _toolRegistrar(): ToolRegistrar {
		return {
			register: (name, descriptor, handler) =>
				this._registerHandlerWithDescriptor(name, descriptor, handler),
		};
	}

	/**
	 * Run every optional-capability preparer once: probe the environment and let
	 * each register its tools only when available. A failing preparer is isolated
	 * and recorded as disabled. Invoked from {@link startMcp} after the core tools
	 * are in place.
	 */
	private async _prepareTools(): Promise<void> {
		const registrar = this._toolRegistrar();
		for (const preparer of this._preparers) {
			let enabled = false;
			try {
				enabled = await preparer.prepare(registrar);
			} catch (err) {
				log.warn('mcp.prepare.failed', { preparer: preparer.name, error: String(err) });
			}
			this._capabilities.set(preparer.name, enabled);
			log.info('mcp.prepare', { preparer: preparer.name, enabled });
		}
	}

	/** Whether DataForge was probed as enabled at startup. */
	private _isDataForgeReady(): boolean {
		return this._capabilities.get(this._dataForgePreparer.name) === true;
	}

	/** Compile the `read` tool args into a neutral {@link ReadQuery}: structured `filters`
	 *  become a {@link FilterNode}; a raw `$filter` string and `expand` are carried as
	 *  OData-only escape hatches. The normalized {@link ReadResult} is mapped back to the
	 *  tool's established output shape (a bare array, or `{ total, value }` when counting). */
	private async _read(args: any): Promise<unknown> {
		const { entity, filter, filters, select, top, expand, orderBy, skip, count } = args;
		const odata: { rawFilter?: string; expand?: string[] } = {};
		if (filter) {
			odata.rawFilter = filter;
		}
		if (Array.isArray(expand) && expand.length > 0) {
			odata.expand = expand;
		}
		const node = buildFilterNode(filters);
		const order = parseOrderBy(orderBy);
		const query: ReadQuery = {
			entity,
			top: top ?? DEFAULT_READ_TOP,
			...(select ? { columns: select } : {}),
			...(node ? { filter: node } : {}),
			...(order ? { order } : {}),
			...(skip !== undefined ? { skip } : {}),
			...(count !== undefined ? { count } : {}),
			...(Object.keys(odata).length ? { odata } : {}),
		};
		const result = await this._engines.crud.read(query);
		return count ? { total: result.totalCount, value: result.items } : result.items;
	}

	/** When DataForge is enabled, prefer its richer column details and fall back to exact
	 *  OData `$metadata` on a per-call miss; otherwise go straight to OData. The `source`
	 *  discriminator is part of the public tool contract — preserve it. */
	private async _describeEntity(entitySet: string): Promise<unknown> {
		if (this._isDataForgeReady()) {
			const dataForge = await this._dataForge.getColumnsOrNull(entitySet);
			if (dataForge !== null) {
				return { source: 'dataforge', entitySet, dataForge };
			}
		}
		const metadata = await this._engines.crud.describeEntity(entitySet);
		return { source: 'odata', entitySet, metadata };
	}

	/**
	 * The client tool surface as data. Handlers return raw domain results; MCP content
	 * wrapping is applied once by {@link _normalizeToToolHandler}. Adding a tool is a new
	 * row here (plus its descriptor) — no new bespoke wrapping. Mutating tools are listed
	 * separately and only registered when not in readonly mode.
	 */
	private _clientToolDefs(): { core: ClientToolDef[]; mutating: ClientToolDef[] } {
		const { crud, user, sysSettings, process, feature, adminOperation, configuration } =
			this._engines;
		const core: ClientToolDef[] = [
			{
				name: 'get-current-user-info',
				descriptor: getCurrentUserInfoDescriptor,
				input: getCurrentUserInfoInput,
				run: () => user.getCurrentUserInfo(),
			},
			{
				name: 'list-entities',
				descriptor: listEntitiesDescriptor,
				input: listEntitiesInput,
				run: async () => ({ results: await crud.listEntitySets() }),
			},
			{
				name: 'describe-entity',
				descriptor: describeEntityDescriptor,
				input: describeEntityInput,
				run: ({ entitySet }) => this._describeEntity(entitySet),
			},
			{
				name: 'read',
				descriptor: readDescriptor,
				input: readInput,
				run: (args) => this._read(args),
			},
			{
				name: 'query-sys-settings',
				descriptor: querySysSettingsDescriptor,
				input: querySysSettingsInput,
				run: ({ sysSettingCodes }) => sysSettings.queryValues(sysSettingCodes),
			},
		];
		const mutating: ClientToolDef[] = [
			{
				name: 'create',
				descriptor: createDescriptor,
				input: createInput,
				run: ({ entity, data }) => crud.create({ entity, data }),
			},
			{
				name: 'update',
				descriptor: updateDescriptor,
				input: updateInput,
				run: ({ entity, id, data }) => crud.update({ entity, id, data }),
			},
			{
				name: 'delete',
				descriptor: deleteDescriptor,
				input: deleteInput,
				run: ({ entity, id }) => crud.delete({ entity, id }),
			},
			{
				name: 'execute-process',
				descriptor: executeProcessDescriptor,
				input: executeProcessInput,
				run: ({ processName, parameters }) =>
					process.execute({ processName, parameters: parameters || {} }),
			},
			{
				name: 'set-sys-settings-value',
				descriptor: setSysSettingsValueDescriptor,
				input: setSysSettingsValueInput,
				run: ({ sysSettingsValues }) => sysSettings.setValues(sysSettingsValues),
			},
			{
				name: 'create-sys-setting',
				descriptor: createSysSettingDescriptor,
				input: createSysSettingInput,
				run: ({ definition, initialValue }) =>
					sysSettings.createSetting({ definition, initialValue }),
			},
			{
				name: 'update-sys-setting-definition',
				descriptor: updateSysSettingDefinitionDescriptor,
				input: updateSysSettingDefinitionInput,
				run: ({ id, definition }) =>
					sysSettings.updateDefinition({
						...(definition as SysSettingDefinitionUpdate),
						id,
					}),
			},
			{
				name: 'refresh-feature-cache',
				descriptor: refreshFeatureCacheDescriptor,
				input: refreshFeatureCacheInput,
				run: ({ featureCode }) => feature.clearFeaturesCache(featureCode),
			},
			{
				name: 'upsert-admin-operation',
				descriptor: upsertAdminOperationDescriptor,
				input: upsertAdminOperationInput,
				run: ({ id, name, code, description }) =>
					adminOperation.upsertAdminOperation({
						...(id !== undefined ? { id } : {}),
						name,
						code,
						...(description !== undefined ? { description } : {}),
					}),
			},
			{
				name: 'delete-admin-operation',
				descriptor: deleteAdminOperationDescriptor,
				input: deleteAdminOperationInput,
				run: ({ ids }) => adminOperation.deleteAdminOperation(ids),
			},
			{
				name: 'set-admin-operation-grantee',
				descriptor: setAdminOperationGranteeDescriptor,
				input: setAdminOperationGranteeInput,
				run: ({ adminOperationId, adminUnitIds, canExecute }) =>
					adminOperation.setAdminOperationGrantee({
						adminOperationId,
						adminUnitIds,
						canExecute,
					}),
			},
			{
				name: 'delete-admin-operation-grantee',
				descriptor: deleteAdminOperationGranteeDescriptor,
				input: deleteAdminOperationGranteeInput,
				run: ({ ids }) => adminOperation.deleteAdminOperationGrantee(ids),
			},
			{
				name: 'call-configuration-service',
				descriptor: callConfigurationServiceDescriptor,
				input: callConfigurationServiceInput,
				run: ({ service, method, httpMethod, body, query }) =>
					configuration.call({
						service,
						method,
						httpMethod,
						...(body !== undefined ? { body } : {}),
						...(query !== undefined ? { query } : {}),
					}),
			},
		];
		return { core, mutating };
	}

	private _registerClientTools() {
		const { core, mutating } = this._clientToolDefs();
		const defs = this._readonly ? core : [...core, ...mutating];
		for (const def of defs) {
			this._registerHandlerWithDescriptor(
				def.name,
				def.descriptor,
				withValidation(def.input, def.run),
			);
		}
	}

	public async startMcp() {
		if (this._mcp) {
			return this._mcp;
		}
		this._mcp = new McpServer({ name: this._serverName, version: this._serverVersion });
		this._registerData();
		// Probe optional capabilities WITHOUT blocking the MCP handshake. These do
		// network I/O (DataForge/Global Search probes, and the publishing app's
		// tools/list, which can be slow) — awaiting here would delay connect past the
		// client's init timeout. They register into the live _mcp as they resolve and
		// the SDK emits notifications/tools/list_changed so clients pick them up.
		void this._prepareTools().catch((err) =>
			log.warn('mcp.prepare.error', { error: String(err) }),
		);
		log.serverStart(this._serverName, this._serverVersion, {
			tools: Array.from(this._handlers.keys()),
			prompts: ALL_PROMPTS.length,
		});
		return this._mcp;
	}

	public async stopMcp() {
		if (!this._mcp) {
			return;
		}
		try {
			this._mcp.close();
			log.serverStop(this._serverName, this._serverVersion);
		} catch (err) {
			log.warn('mcp.stop.failed', { error: String(err) });
		}
	}
}
