import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
	CreatioEngineManager,
	ICreatioAuthProvider,
	ReadQuery,
	SysSettingDefinitionUpdate,
} from '../../creatio';
import log from '../../log';
import {
	envBool,
	getBaseUrlOverride,
	redactError,
	redactSecrets,
	withValidation,
} from '../../utils';
import { NAME, VERSION } from '../../version';

import { CrtMcpPublishingClient } from './crtmcp/crt-mcp-client';
import { CrtMcpPublishingToolPreparer } from './crtmcp/crt-mcp-tool-preparer';
import { DataForgeClient } from './dataforge/dataforge-client';
import { DataForgeToolPreparer } from './dataforge/dataforge-tool-preparer';
import { buildFilterNode, parseOrderBy } from './filters';
import { GlobalSearchClient } from './globalsearch/globalsearch-client';
import { GlobalSearchToolPreparer } from './globalsearch/globalsearch-tool-preparer';
import { ALL_PROMPTS } from './prompts-data';
import { DEFAULT_TENANT_KEY, TenantToolRegistry, TenantToolState } from './tenant-tool-registry';
import { ToolHandler, ToolPreparer, ToolRegistrar } from './tool-preparer';
import {
	buildReadDescriptor,
	buildReadInput,
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
	/** Skip the DataForge capability probe AND its tools entirely — even where DataForge is
	 *  available — so no probe/describe traffic is sent and no tokens are spent on it. */
	disableDataForge?: boolean;
	/** Skip the Global Search capability probe AND its tool entirely (same rationale). */
	disableGlobalSearch?: boolean;
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
	// After a preparer's probe THROWS (no verdict recorded), back off before re-probing it, so a
	// persistently-failing capability doesn't fire its network probe on every new session connect.
	private static readonly PROBE_RETRY_COOLDOWN_MS = 30_000;

	private readonly _engines: CreatioEngineManager;
	// Static tool surface, shared across every session and tenant: these handlers are user-agnostic
	// (they read identity from the per-request context at call time) and identical for every Creatio
	// instance. Each new session server gets the full set; capability/dynamic tools are NOT here —
	// they live per-tenant in `_registry` so one tenant's verdict/tools never leak to another.
	private readonly _descriptors = new Map<string, any>();
	private readonly _handlers = new Map<string, ToolHandler>();
	// Per-tenant capability + dynamic-tool + live-session state, keyed by effective Creatio base URL.
	// One McpServer per live transport/session (a single McpServer connects to only one transport,
	// so a shared singleton would reject a 2nd concurrent connect() with "Already connected"); the
	// registry tracks those session servers per tenant so a late-probed tool is pushed only into the
	// sessions of the tenant it was discovered for.
	private readonly _registry: TenantToolRegistry;
	// DataForge access layer + optional-capability preparers. The probe verdict is recorded PER
	// TENANT (in `_registry`) so core tools (describe-entity) route through a capability only when it
	// is actually enabled for the calling tenant's instance.
	private readonly _dataForge: DataForgeClient;
	private readonly _dataForgePreparer: DataForgeToolPreparer;
	private readonly _globalSearchPreparer: GlobalSearchToolPreparer;
	private readonly _publishedToolsPreparer: CrtMcpPublishingToolPreparer;
	private readonly _preparers: ToolPreparer[];
	private _readonly = false;
	private _serverName = NAME;
	private _serverVersion = VERSION;

	public get authProvider(): ICreatioAuthProvider {
		return this._engines.authProvider;
	}

	constructor(engines: CreatioEngineManager, config: ServerConfig) {
		this._engines = engines;
		this._readonly = config.readonlyMode ?? false;
		this._registry = new TenantToolRegistry();
		this._dataForge = new DataForgeClient(engines.configuration, engines.sysSettings);
		this._dataForgePreparer = new DataForgeToolPreparer(this._dataForge);
		this._globalSearchPreparer = new GlobalSearchToolPreparer(
			new GlobalSearchClient(engines.configuration, engines.sysSettings),
		);
		this._publishedToolsPreparer = new CrtMcpPublishingToolPreparer(
			new CrtMcpPublishingClient(engines.configuration, engines.crud),
			envBool('CREATIO_MCP_ENABLE_PUBLISHED_TOOLS', false),
		);
		// A disabled capability is simply never added to the preparer list, so it is neither
		// probed (no network / no token spend) nor registered as a tool.
		this._preparers = [
			...(config.disableDataForge ? [] : [this._dataForgePreparer]),
			...(config.disableGlobalSearch ? [] : [this._globalSearchPreparer]),
			this._publishedToolsPreparer,
		];
		this._registerClientTools();
	}

	/** Register the static, tenant-agnostic surface (core/mutating tools + prompts) into a session. */
	private _registerAllInto(mcp: McpServer) {
		for (const [name, handler] of this._handlers.entries()) {
			this._registerAsTool(mcp, name, this._descriptors.get(name), handler);
		}
		this._registerPrompts(mcp);
	}

	/** Record a static tool in the shared maps. Registered into each session by {@link
	 *  _registerAllInto}; called only at construction, before any session exists. */
	private _registerStaticTool(name: string, descriptor: any, handler: ToolHandler) {
		this._handlers.set(name, handler);
		this._descriptors.set(name, descriptor);
	}

	private _normalizeToToolHandler(handler: ToolHandler) {
		return async (args: any) => {
			// Outward boundary to the LLM client: scrub any credential that leaked into the error
			// message (AGENTS invariant #7) while preserving the Error type/stack, then rethrow so
			// the MCP layer relays it (we never silently swallow — invariant #4). `.catch` keeps
			// `result` typed exactly as the handler's return (the callback only throws).
			const result = await handler(args).catch((err: unknown) => {
				throw redactError(err);
			});
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
						// Compact (not pretty-printed): this is a machine/LLM transport, so the 2-space
						// indentation only inflated byte/token size and serialization cost.
						// Scrubbed at this outward edge so a token that slipped into a result field is
						// never relayed to the client.
						text: redactSecrets(
							typeof result === 'string' ? result : JSON.stringify(result),
						),
					},
				],
			};
		};
	}

	private _registerAsTool(mcp: McpServer, name: string, descriptor: any, handler: ToolHandler) {
		try {
			const toolDescriptor =
				descriptor ||
				({
					title: name,
					description: `Tool ${name}`,
					inputSchema: {},
				} as any);
			mcp.registerTool(name, toolDescriptor, async (args: any) => {
				return this._normalizeToToolHandler(handler)(args);
			});
			log.info('mcp.tool.register', { tool: name });
		} catch (err) {
			log.warn('mcp.tool.register.failed', { tool: name, error: String(err) });
		}
	}

	private _registerPrompts(mcp: McpServer) {
		try {
			for (const prompt of ALL_PROMPTS) {
				mcp.registerPrompt(
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

	/** The tenant bucket key for a request's base-URL override: the normalized override (gateway
	 *  multi-tenant) or {@link DEFAULT_TENANT_KEY} for every single-tenant mode. Mirrors how the
	 *  HTTP client resolves the effective base URL, so tools and caches key on the same tenant. */
	private _tenantKey(baseUrlOverride?: string): string {
		const trimmed = baseUrlOverride?.trim();
		return trimmed ? trimmed.replace(/\/$/, '') : DEFAULT_TENANT_KEY;
	}

	/** The current request's tenant state (resolved from the per-request base-URL override). Falls
	 *  back to the default tenant when there is no active request context (e.g. stdio, tests). */
	private _currentTenantState(): TenantToolState {
		return this._registry.getState(this._tenantKey(getBaseUrlOverride()));
	}

	/** Adapter exposing handler registration to {@link ToolPreparer}s — scoped to ONE tenant: a
	 *  discovered tool is recorded in that tenant's state and pushed into its live sessions only. */
	private _toolRegistrar(state: TenantToolState): ToolRegistrar {
		return {
			register: (name, descriptor, handler) => {
				state.dynamicTools.set(name, { descriptor, handler });
				// Late registration (the probe runs after sessions may already be connected): push
				// the tool into the tenant's live session servers so connected clients see it — the
				// SDK emits notifications/tools/list_changed. New sessions pick it up on connect.
				for (const mcp of state.sessionServers) {
					this._registerAsTool(mcp, name, descriptor, handler);
				}
			},
		};
	}

	/**
	 * Probe each optional-capability preparer that has no verdict yet FOR THIS TENANT and let it
	 * register its tools when available. A preparer that returns cleanly (true/false) gets a recorded
	 * verdict and is never re-probed; one that THROWS (e.g. the caller's identity isn't usable yet)
	 * records nothing so a later authenticated connect can retry it — which also makes registration
	 * idempotent (an already-enabled preparer is skipped, so its tools are never registered twice).
	 * Invoked from {@link ensureCapabilitiesProbed} within a request context so probe calls carry the
	 * caller's identity. Returns whether EVERY preparer now has a verdict (the probe is complete).
	 */
	private async _prepareTools(state: TenantToolState): Promise<boolean> {
		const registrar = this._toolRegistrar(state);
		const now = Date.now();
		for (const preparer of this._preparers) {
			if (state.capabilities.has(preparer.name)) {
				continue; // definitive verdict already recorded — don't re-probe or re-register
			}
			if (now < (state.cooldownUntil.get(preparer.name) ?? 0)) {
				continue; // recently failed — back off rather than re-probe on every connect
			}
			try {
				const enabled = await preparer.prepare(registrar);
				state.capabilities.set(preparer.name, enabled);
				log.info('mcp.prepare', { preparer: preparer.name, enabled });
			} catch (err) {
				// No verdict — leave unrecorded so a later authenticated connect retries, but not
				// before the cooldown elapses.
				state.cooldownUntil.set(preparer.name, Date.now() + Server.PROBE_RETRY_COOLDOWN_MS);
				log.warn('mcp.prepare.failed', { preparer: preparer.name, error: String(err) });
			}
		}
		return this._preparers.every((p) => state.capabilities.has(p.name));
	}

	/** Whether DataForge was probed as enabled for the given tenant (defaults to the current one). */
	private _isDataForgeReady(state: TenantToolState = this._currentTenantState()): boolean {
		return state.capabilities.get(this._dataForgePreparer.name) === true;
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

	/** When DataForge is enabled, prefer its richer column details and fall back to the active
	 *  CRUD backend's schema on a per-call miss. The `source` discriminator is part of the
	 *  public tool contract and reflects where the schema actually came from. */
	private async _describeEntity(entitySet: string): Promise<unknown> {
		if (this._isDataForgeReady(this._currentTenantState())) {
			const dataForge = await this._dataForge.getColumnsOrNull(entitySet);
			if (dataForge !== null) {
				return { source: 'dataforge', entitySet, dataForge };
			}
		}
		const metadata = await this._engines.crud.describeEntity(entitySet);
		const source = this._engines.crud.kind === 'creatio-dataservice' ? 'dataservice' : 'odata';
		return { source, entitySet, metadata };
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
				descriptor: buildReadDescriptor(crud.capabilities),
				input: buildReadInput(crud.capabilities),
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
			this._registerStaticTool(def.name, def.descriptor, withValidation(def.input, def.run));
		}
	}

	/**
	 * Build a fresh {@link McpServer} for one transport/session, registering the static surface plus
	 * the calling tenant's already-discovered dynamic tools, and track it under that tenant so the
	 * capability probe can later push late-discovered tools into it. Each session MUST get its own
	 * server (a single McpServer connects to only one transport). `baseUrlOverride` (gateway
	 * `X-Creatio-Base-Url`) selects the tenant; absent ⇒ the single default tenant.
	 */
	public createSessionServer(baseUrlOverride?: string): McpServer {
		const mcp = new McpServer({ name: this._serverName, version: this._serverVersion });
		this._registerAllInto(mcp);
		const state = this._registry.getState(this._tenantKey(baseUrlOverride));
		for (const [name, tool] of state.dynamicTools) {
			this._registerAsTool(mcp, name, tool.descriptor, tool.handler);
		}
		state.sessionServers.add(mcp);
		log.serverStart(this._serverName, this._serverVersion, {
			tools: [...this._handlers.keys(), ...state.dynamicTools.keys()],
			prompts: ALL_PROMPTS.length,
		});
		return mcp;
	}

	/**
	 * Probe optional capabilities once per tenant, WITHOUT blocking the MCP handshake. These do
	 * network I/O (DataForge/Global Search probes, and the publishing app's tools/list, which can
	 * be slow) — awaiting would delay connect past the client's init timeout. Discovered tools
	 * register into the tenant's live session servers as they resolve (the SDK emits
	 * notifications/tools/list_changed) and into the tenant state for its future sessions.
	 *
	 * MUST be called from within the per-request context ({@link runWithContext}) so the probe's
	 * Creatio calls carry the caller's identity/token — otherwise broker mode resolves no user.
	 * `baseUrlOverride` selects the tenant; absent ⇒ the single default tenant.
	 */
	public ensureCapabilitiesProbed(baseUrlOverride?: string): void {
		const state = this._registry.getState(this._tenantKey(baseUrlOverride));
		if (state.probeComplete || state.probeInFlight) {
			return;
		}
		state.probeInFlight = true;
		void this._prepareTools(state)
			.then((complete) => {
				state.probeComplete = complete;
			})
			.catch((err) => log.warn('mcp.prepare.error', { error: String(err) }))
			.finally(() => {
				state.probeInFlight = false;
			});
	}

	/** Untrack and close one session's server (call when its transport closes). */
	public releaseSessionServer(mcp: McpServer): void {
		this._registry.findBySession(mcp)?.sessionServers.delete(mcp);
		try {
			mcp.close();
		} catch (err) {
			log.warn('mcp.stop.failed', { error: String(err) });
		}
	}

	/** Close every live session server across all tenants (process shutdown). */
	public async stopAll(): Promise<void> {
		for (const mcp of this._registry.allSessionServers()) {
			try {
				mcp.close();
			} catch (err) {
				log.warn('mcp.stop.failed', { error: String(err) });
			}
		}
		this._registry.clear();
		log.serverStop(this._serverName, this._serverVersion);
	}
}
