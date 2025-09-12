import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NAME, VERSION } from '../version';
import type { CreatioClient } from '../creatio';
import log from '../log';

function withValidation<T extends z.ZodTypeAny>(
	schema: T,
	handler: (args: z.infer<T>) => Promise<any>,
) {
	return async (payload: unknown) => handler(schema.parse(payload));
}

function makeToolDescriptor(opts: {
	title: string;
	description: string;
	inputShape: Record<string, z.ZodTypeAny>;
}) {
	return {
		title: opts.title,
		description: opts.description,
		inputSchema: opts.inputShape,
	};
}

const ReadInputShape = {
	entity: z
		.string()
		.min(1)
		.describe(
			'OData v4 entity set name. Use names without "Collection" (e.g., Contact, Account, Activity).',
		),

	// приймаємо "" і перетворюємо на undefined, щоб не падало на min(1)
	filter: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			z.string().min(1).optional(),
		)
		.describe(
			"OData $filter. Strings MUST use single quotes; escape embedded ' as ''. Operators: eq, ne, gt, ge, lt, le, and, or, not, contains, startswith, endswith. Examples: contains(Name,'Acme') and IsActive eq true; Email eq 'user@example.com'.",
		),

	// приймаємо [] і перетворюємо на undefined (жодних вимог до min)
	select: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe("Fields to return. Optional but recommended. Example: ['Id','Name','Email']"),

	// часто приходить як рядок з UI — коерсимо до числа
	top: z.coerce
		.number()
		.int()
		.positive()
		.max(1000)
		.optional()
		.describe('Max records to return (use 25–200 to keep responses small).'),
} as const;

const ReadInput = z.object(ReadInputShape);

const readDescriptor = makeToolDescriptor({
	title: 'Read from Creatio OData',
	description:
		'Reads records via OData v4. Only `entity` is required. Optional: `$filter`, `$select`, `$top`.\n' +
		'- Prefer setting `top`.\n' +
		"- In $filter wrap strings in single quotes; escape as O''Connor.\n" +
		"Examples:\n- entity=Contact, filter=\"contains(Name,'Andrii')\", select=['Id','Name','Email'], top=25",
	inputShape: ReadInputShape,
});

const CreateInputShape = {
	entity: z.string().min(1).describe('Target entity set (v4), e.g., Activity, Account, Contact.'),
	data: z
		.record(z.string(), z.any())
		.describe(
			'JSON fields to set. Dates in ISO 8601; booleans true/false; lookups as GUIDs in *_Id fields. Use read first to discover required fields.',
		),
} as const;
const CreateInput = z.object(CreateInputShape);

const createDescriptor = makeToolDescriptor({
	title: 'Create in Creatio OData',
	description:
		"Creates a single record via OData v4.\nExamples:\n- entity=Activity, data={ Title:'Call with Andrii', StartDate:'2025-09-12T12:00:00Z' }\n- entity=Account, data={ Name:'Acme UA', Code:'ACM-001' }",
	inputShape: CreateInputShape,
});

const UpdateInputShape = {
	entity: z.string().min(1).describe('Entity set (v4), e.g., Account, Contact.'),
	id: z
		.string()
		.min(1)
		.describe(
			'Primary key of the record. If GUID/numeric, pass as-is; string keys will be quoted automatically.',
		),
	data: z.record(z.string(), z.any()).describe('Partial JSON with fields to change.'),
} as const;
const UpdateInput = z.object(UpdateInputShape);

const updateDescriptor = makeToolDescriptor({
	title: 'Update in Creatio OData',
	description:
		"PATCH update of a single record by Id via OData v4.\nExamples:\n- entity=Account, id='<GUID>', data={ Name:'Acme Europe' }\n- entity=Activity, id='<GUID>', data={ StatusId:'<Done GUID>' }",
	inputShape: UpdateInputShape,
});

const DeleteInputShape = {
	entity: z.string().min(1).describe('Entity set (v4), e.g., Contact, Account.'),
	id: z
		.string()
		.min(1)
		.describe(
			'Primary key to delete. If GUID/numeric, pass as-is; string keys will be quoted automatically.',
		),
} as const;
const DeleteInput = z.object(DeleteInputShape);

const deleteDescriptor = makeToolDescriptor({
	title: 'Delete in Creatio OData',
	description:
		'Deletes a single record by Id via OData v4. Prefer soft-delete via `update` when possible.',
	inputShape: DeleteInputShape,
});

const ListEntitiesInput = z.object({});
const listEntitiesDescriptor = makeToolDescriptor({
	title: 'List available entity sets',
	description:
		'Return a list of all OData entity set names that can be queried or modified via Creatio OData.',
	inputShape: {},
});

// DESCRIBE ENTITY
const DescribeEntityInputShape = {
	entitySet: z
		.string()
		.min(1)
		.describe('The name of the OData entity set to describe, e.g. "ContactCollection".'),
} as const;
const DescribeEntityInput = z.object(DescribeEntityInputShape);
const describeEntityDescriptor = makeToolDescriptor({
	title: 'Describe an entity set',
	description:
		'Return metadata for a given OData entity set, including field names, types, constraints, and relationships.',
	inputShape: DescribeEntityInputShape,
});

const SearchInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Free-text search query. The server will look up common entities (e.g., Contact, Account, Activity) using contains(Name, <query>) and return top matches.',
		),
} as const;
const SearchInput = z.object(SearchInputShape);

const searchDescriptor = makeToolDescriptor({
	title: 'Search',
	description:
		'Return a list of relevant items given a user query. Arguments: a single query string. Returns one content item with type="text" containing a JSON-encoded object: {"results":[{"id","title","url"}]}. The "id" must be usable by the fetch tool.',
	inputShape: SearchInputShape,
});

const FetchInputShape = {
	id: z
		.string()
		.min(1)
		.describe(
			'Unique identifier of the search result to fetch. Format: "EntitySet:GUID" (e.g., "Contact:3f2e...").',
		),
} as const;
const FetchInput = z.object(FetchInputShape);

const fetchDescriptor = makeToolDescriptor({
	title: 'Fetch',
	description:
		'Retrieve the full contents of a search result given its id. Returns one content item with type="text" containing a JSON-encoded object: {"id","title","text","url","metadata"}.',
	inputShape: FetchInputShape,
});

type ToolHandler = (payload: any) => Promise<any>;

export class Server {
	private handlers = new Map<string, ToolHandler>();
	private descriptors = new Map<string, any>();
	private mcp?: McpServer;

	constructor(
		private client: CreatioClient & {
			listEntitySets?: () => Promise<string[]>;
			describeEntity?: (entity: string) => Promise<any>;
		},
		private serverName = NAME,
		private serverVersion = VERSION,
	) {
		this._registerClientTools(client);
	}

	private _registerClientTools(client: CreatioClient) {
		this._registerHandlerWithDescriptor(
			'read',
			readDescriptor,
			withValidation(ReadInput, async ({ entity, filter, select, top }) => {
				return client.read(entity, filter, select, top);
			}),
		);

		this._registerHandlerWithDescriptor(
			'create',
			createDescriptor,
			withValidation(CreateInput, async ({ entity, data }) => client.create(entity, data)),
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

		// DESCRIBE ENTITY
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
		this.handlers.set(name, handler);
		this.descriptors.set(name, descriptor);
		if (this.mcp) this._registerAsTool(name, handler);
	}

	private _normalizeToToolHandler(handler: ToolHandler) {
		return async (args: any) => {
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
		};
	}

	private _registerAsTool(name: string, handler: ToolHandler) {
		if (!this.mcp) return;
		try {
			const descriptor =
				this.descriptors.get(name) ||
				({
					title: name,
					description: `Tool ${name}`,
					inputSchema: {},
				} as any);

			this.mcp.registerTool(name, descriptor, this._normalizeToToolHandler(handler));
			log.info('mcp.tool.register', { tool: name });
		} catch (err) {
			log.warn('mcp.tool.register.failed', { tool: name, error: String(err) });
		}
	}

	public async startMcp() {
		if (this.mcp) return this.mcp;
		this.mcp = new McpServer({ name: this.serverName, version: this.serverVersion });
		for (const [name, handler] of this.handlers.entries()) this._registerAsTool(name, handler);
		log.serverStart(this.serverName, this.serverVersion, {
			tools: Array.from(this.handlers.keys()),
		});
		return this.mcp;
	}

	public async stopMcp() {
		if (!this.mcp) return;
		try {
			this.mcp.close();
			log.serverStop(this.serverName, this.serverVersion);
		} catch (err) {
			log.warn('mcp.stop.failed', { error: String(err) });
		}
	}
}
