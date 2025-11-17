import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
	CreatioEngineManager,
	ICreatioAuthProvider,
	SysSettingDefinitionUpdate,
} from '../../creatio';
import log from '../../log';
import { withValidation } from '../../utils';
import { NAME, VERSION } from '../../version';

import { buildFilterFromStructured } from './filters';
import { ALL_PROMPTS } from './prompts-data';
import {
	createDescriptor,
	createInput,
	createSysSettingDescriptor,
	createSysSettingInput,
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
	setSysSettingsValueDescriptor,
	setSysSettingsValueInput,
	updateDescriptor,
	updateInput,
	updateSysSettingDefinitionDescriptor,
	updateSysSettingDefinitionInput,
} from './tools-data';

type ToolHandler = (payload: any) => Promise<any>;

export interface ServerConfig {
	readonlyMode?: boolean;
}

export class Server {
	private readonly _engines: CreatioEngineManager;
	private readonly _descriptors = new Map<string, any>();
	private readonly _handlers = new Map<string, ToolHandler>();
	private _mcp?: McpServer;
	private _readonly = false;
	private _serverName = NAME;
	private _serverVersion = VERSION;

	public get authProvider(): ICreatioAuthProvider {
		return this._engines.authProvider;
	}

	constructor(engines: CreatioEngineManager, config: ServerConfig) {
		this._engines = engines;
		this._readonly = config.readonlyMode ?? false;
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
			if (result && typeof result === 'object' && 'content' in result) {
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

	private _registerClientTools() {
		const crud = this._engines.crud;
		const user = this._engines.user;
		const sysSettings = this._engines.sysSettings;
		this._registerHandlerWithDescriptor(
			'get-current-user-info',
			getCurrentUserInfoDescriptor,
			withValidation(getCurrentUserInfoInput, () => user.getCurrentUserInfo()),
		);
		this._registerHandlerWithDescriptor(
			'list-entities',
			listEntitiesDescriptor,
			withValidation(listEntitiesInput, async () => {
				const sets = await crud.listEntitySets();
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ results: sets }),
						},
					],
				};
			}),
		);
		this._registerHandlerWithDescriptor(
			'describe-entity',
			describeEntityDescriptor,
			withValidation(describeEntityInput, async ({ entitySet }) => {
				const schema = await crud.describeEntity(entitySet);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(schema),
						},
					],
				};
			}),
		);
		this._registerHandlerWithDescriptor(
			'read',
			readDescriptor,
			withValidation(
				readInput,
				async ({ entity, filter, filters, select, top, expand, orderBy }) => {
					const structured = buildFilterFromStructured(filters);
					let finalFilter = filter || structured;
					if (filter && structured) {
						finalFilter = `(${filter}) and (${structured})`;
					}
					return crud.read({
						entity,
						filter: finalFilter ?? undefined,
						select,
						top,
						expand,
						orderBy,
					});
				},
			),
		);
		this._registerHandlerWithDescriptor(
			'query-sys-settings',
			querySysSettingsDescriptor,
			withValidation(querySysSettingsInput, async ({ sysSettingCodes }) => {
				const result = await sysSettings.queryValues(sysSettingCodes);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result, null, 2),
						},
					],
				};
			}),
		);
		if (!this._readonly) {
			const process = this._engines.process;
			this._registerHandlerWithDescriptor(
				'create',
				createDescriptor,
				withValidation(createInput, async ({ entity, data }) =>
					crud.create({ entity, data }),
				),
			);
			this._registerHandlerWithDescriptor(
				'update',
				updateDescriptor,
				withValidation(updateInput, async ({ entity, id, data }) =>
					crud.update({ entity, id, data }),
				),
			);
			this._registerHandlerWithDescriptor(
				'delete',
				deleteDescriptor,
				withValidation(deleteInput, async ({ entity, id }) => crud.delete({ entity, id })),
			);
			this._registerHandlerWithDescriptor(
				'execute-process',
				executeProcessDescriptor,
				withValidation(executeProcessInput, async ({ processName, parameters }) => {
					const result = await process.execute({
						processName,
						parameters: parameters || {},
					});
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}),
			);
			this._registerHandlerWithDescriptor(
				'set-sys-settings-value',
				setSysSettingsValueDescriptor,
				withValidation(setSysSettingsValueInput, async ({ sysSettingsValues }) => {
					const result = await sysSettings.setValues(sysSettingsValues);
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result),
							},
						],
					};
				}),
			);
			this._registerHandlerWithDescriptor(
				'create-sys-setting',
				createSysSettingDescriptor,
				withValidation(createSysSettingInput, async ({ definition, initialValue }) => {
					const result = await sysSettings.createSetting({ definition, initialValue });
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}),
			);
			this._registerHandlerWithDescriptor(
				'update-sys-setting-definition',
				updateSysSettingDefinitionDescriptor,
				withValidation(updateSysSettingDefinitionInput, async ({ id, definition }) => {
					const result = await sysSettings.updateDefinition({
						...(definition as SysSettingDefinitionUpdate),
						id,
					});
					return {
						content: [
							{
								type: 'text',
								text: JSON.stringify(result, null, 2),
							},
						],
					};
				}),
			);
		}
	}

	public async startMcp() {
		if (this._mcp) {
			return this._mcp;
		}
		this._mcp = new McpServer({ name: this._serverName, version: this._serverVersion });
		this._registerData();
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
