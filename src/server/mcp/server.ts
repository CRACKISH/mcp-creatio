import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CreatioClient } from '../../creatio';
import log from '../../log';
import { withValidation } from '../../utils';
import { NAME, VERSION } from '../../version';

import { buildFilterFromStructured } from './filters';
import {
	CreateInput,
	DeleteInput,
	DescribeEntityInput,
	FetchInput,
	ListEntitiesInput,
	ReadInput,
	SearchInput,
	UpdateInput,
	createDescriptor,
	deleteDescriptor,
	describeEntityDescriptor,
	fetchDescriptor,
	listEntitiesDescriptor,
	readDescriptor,
	searchDescriptor,
	updateDescriptor,
} from './tools-data';

type ToolHandler = (payload: any) => Promise<any>;

export interface ServerConfig {
	readonly?: boolean;
}

export class Server {
	private _serverName = NAME;
	private _serverVersion = VERSION;
	private _readonly = false;
	private _handlers = new Map<string, ToolHandler>();
	private _descriptors = new Map<string, any>();
	private _mcp?: McpServer;

	constructor(
		private _client: CreatioClient,
		config: ServerConfig,
	) {
		this._readonly = config.readonly ?? false;
		this._registerClientTools(this._client);
	}

	private _registerClientTools(client: CreatioClient) {
		this._registerHandlerWithDescriptor(
			'read',
			readDescriptor,
			withValidation(ReadInput, async ({ entity, filter, filters, select, top }) => {
				const structured = buildFilterFromStructured(filters);
				let finalFilter = filter || structured;
				if (filter && structured) finalFilter = `(${filter}) and (${structured})`;
				return client.read(entity, finalFilter, select, top);
			}),
		);

		if (!this._readonly) {
			this._registerHandlerWithDescriptor(
				'create',
				createDescriptor,
				withValidation(CreateInput, async ({ entity, data }) =>
					client.create(entity, data),
				),
			);

			this._registerHandlerWithDescriptor(
				'update',
				updateDescriptor,
				withValidation(UpdateInput, async ({ entity, id, data }) =>
					client.update(entity, id, data),
				),
			);

			this._registerHandlerWithDescriptor(
				'delete',
				deleteDescriptor,
				withValidation(DeleteInput, async ({ entity, id }) => client.delete(entity, id)),
			);
		}

		this._registerHandlerWithDescriptor(
			'list-entities',
			listEntitiesDescriptor,
			withValidation(ListEntitiesInput, async () => {
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
			withValidation(DescribeEntityInput, async ({ entitySet }) => {
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
			'search',
			searchDescriptor,
			withValidation(SearchInput, async ({ query }) => {
				const candidateEntities = ['Contact', 'Account', 'Activity'];
				const results: Array<{ id: string; title: string; url: string }> = [];

				for (const entity of candidateEntities) {
					try {
						const rows = await client.read(
							entity,
							`contains(Name,'${query.replace(/'/g, "''")}')`,
							['Id', 'Name', 'Email', 'Code', 'Title'],
							5,
						);
						for (const r of rows ?? []) {
							const guid = String(r.Id ?? r.id ?? '');
							if (!guid) continue;
							const nameish = r.Name ?? r.Title ?? r.Code ?? guid;
							const id = `${entity}:${guid}`;
							const url = `${(client as any)._root?.() ?? ''}/${entity}(${guid})`;
							results.push({
								id,
								title: `${entity}: ${nameish}`,
								url,
							});
						}
					} catch {}
				}

				const payload = JSON.stringify({ results });
				return {
					content: [{ type: 'text', text: payload }],
				};
			}),
		);

		this._registerHandlerWithDescriptor(
			'fetch',
			fetchDescriptor,
			withValidation(FetchInput, async ({ id }) => {
				const m = /^([^:]+):(.+)$/.exec(id);
				if (!m) {
					const payload = JSON.stringify({
						id,
						title: 'Invalid id format',
						text: 'Expected "EntitySet:GUID".',
						url: '',
						metadata: { error: 'bad_id' },
					});
					return { content: [{ type: 'text', text: payload }] };
				}
				const entity = m[1] as string;
				const guid = m[2];

				let record: any = null;
				try {
					const rows = await client.read(entity, `Id eq ${guid}`, undefined, 1);
					record = Array.isArray(rows) && rows.length ? rows[0] : null;
				} catch (e: any) {
					const payload = JSON.stringify({
						id,
						title: `${entity} ${guid}`,
						text: '',
						url: `${(client as any)._root?.() ?? ''}/${entity}(${guid})`,
						metadata: { error: String(e?.message ?? e) },
					});
					return { content: [{ type: 'text', text: payload }] };
				}

				const title =
					`${entity} ` +
					String(record?.Name ?? record?.Title ?? record?.Code ?? record?.Id ?? guid);
				const url = `${(client as any)._root?.() ?? ''}/${entity}(${guid})`;

				const payload = JSON.stringify({
					id,
					title,
					text: JSON.stringify(record ?? {}, null, 2),
					url,
					metadata: { entity, guid },
				});

				return {
					content: [{ type: 'text', text: payload }],
				};
			}),
		);
	}

	private _registerHandlerWithDescriptor(name: string, descriptor: any, handler: ToolHandler) {
		this._handlers.set(name, handler);
		this._descriptors.set(name, descriptor);
		if (this._mcp) this._registerAsTool(name, handler);
	}

	private _normalizeToToolHandler(handler: ToolHandler) {
		return async (args: any) => {
			try {
				const result = await handler(args);
				if (result && (result.content || result.contents)) return result;
				return {
					content: [
						{
							type: 'text',
							text: typeof result === 'string' ? result : JSON.stringify(result),
						},
					],
				};
			} catch (err: any) {
				throw err;
			}
		};
	}

	private _registerAsTool(name: string, handler: ToolHandler) {
		if (!this._mcp) return;
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

	public async startMcp() {
		if (this._mcp) return this._mcp;
		this._mcp = new McpServer({ name: this._serverName, version: this._serverVersion });
		for (const [name, handler] of this._handlers.entries()) this._registerAsTool(name, handler);
		log.serverStart(this._serverName, this._serverVersion, {
			tools: Array.from(this._handlers.keys()),
		});
		return this._mcp;
	}

	public async stopMcp() {
		if (!this._mcp) return;
		try {
			this._mcp.close();
			log.serverStop(this._serverName, this._serverVersion);
		} catch (err) {
			log.warn('mcp.stop.failed', { error: String(err) });
		}
	}
}
