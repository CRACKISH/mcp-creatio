import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CreatioClient, ICreatioAuthProvider } from '../../creatio';
import log from '../../log';
import { withValidation } from '../../utils';
import { NAME, VERSION } from '../../version';

import { buildFilterFromStructured } from './filters';
import { ALL_PROMPTS } from './prompts-data';
import {
	createDescriptor,
	createInput,
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
	readDescriptor,
	readInput,
	setSysSettingsValueDescriptor,
	setSysSettingsValueInput,
	updateDescriptor,
	updateInput,
} from './tools-data';

type ToolHandler = (payload: any) => Promise<any>;

export interface ServerConfig {
	readonlyMode?: boolean;
}

export class Server {
	private _descriptors = new Map<string, any>();
	private _handlers = new Map<string, ToolHandler>();
	private _mcp?: McpServer;
	private _readonly = false;
	private _serverName = NAME;
	private _serverVersion = VERSION;

	public get authProvider(): ICreatioAuthProvider {
		return this._client.authProvider;
	}

	constructor(
		private _client: CreatioClient,
		config: ServerConfig,
	) {
		this._readonly = config.readonlyMode ?? false;
		this._registerClientTools(this._client);
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
			try {
				const result = await handler(args);
				if (result && (result.content || result.contents)) {
					return result;
				}
				return {
					content: [
						{
							type: 'text',
							text: typeof result === 'string' ? result : JSON.stringify(result),
						},
					],
				};
			} catch (err: any) {
				log.error('mcp.tool.handler', err);
				throw err;
			}
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

	private _registerClientTools(client: CreatioClient) {
		this._registerHandlerWithDescriptor(
			'get-current-user-info',
			getCurrentUserInfoDescriptor,
			withValidation(getCurrentUserInfoInput, () => client.getCurrentUserInfo()),
		);
		this._registerHandlerWithDescriptor(
			'list-entities',
			listEntitiesDescriptor,
			withValidation(listEntitiesInput, async () => {
				const sets = await client.listEntitySets();
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
				const schema = await client.describeEntity(entitySet);
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
					return client.read(entity, finalFilter, select, top, expand, orderBy);
				},
			),
		);
		if (!this._readonly) {
			this._registerHandlerWithDescriptor(
				'create',
				createDescriptor,
				withValidation(createInput, async ({ entity, data }) =>
					client.create(entity, data),
				),
			);
			this._registerHandlerWithDescriptor(
				'update',
				updateDescriptor,
				withValidation(updateInput, async ({ entity, id, data }) =>
					client.update(entity, id, data),
				),
			);
			this._registerHandlerWithDescriptor(
				'delete',
				deleteDescriptor,
				withValidation(deleteInput, async ({ entity, id }) => client.delete(entity, id)),
			);
			this._registerHandlerWithDescriptor(
				'execute-process',
				executeProcessDescriptor,
				withValidation(executeProcessInput, async ({ processName, parameters }) => {
					const result = await client.executeProcess(processName, parameters || {});
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
					const result = await client.setSysSettingsValues(sysSettingsValues);
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
