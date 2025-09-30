import { z } from 'zod';

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

const op = z.enum(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith', 'endswith']);

const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const baseCondition = z.object({
	field: z
		.string()
		.min(1)
		.describe(
			'Field to filter on. For lookups use navigation like Type/Name; for GUID columns use TypeId or Id.',
		),
});

const compareCondition = baseCondition.extend({
	op: op.describe(
		'Comparison operators: eq, ne, gt, ge, lt, le, contains, startswith, endswith.',
	),
	value: value.describe(
		"Value to compare with. Strings are escaped; GUIDs formatted as guid'...'.",
	),
});

const inCondition = baseCondition.extend({
	in: z
		.array(z.union([z.string(), z.number(), z.boolean()]))
		.min(1)
		.describe(
			"Set of values (IN emulation with OR). GUIDs auto-formatted to guid'...' when applicable.",
		),
});

const condition = z.union([compareCondition, inCondition]);

const filtersShape = z
	.object({
		all: z
			.array(condition)
			.min(1)
			.optional()
			.describe(
				'All conditions (AND). Example: [{ field:"TypeId", op:"eq", value:"<GUID>" }]',
			),
		any: z
			.array(condition)
			.min(1)
			.optional()
			.describe(
				'Any condition (OR). Example: [{ field:"Type/Name", op:"eq", value:"Employee" }, { field:"Type/Name", op:"eq", value:"Manager" }]',
			),
	})
	.describe(
		'Structured filters to auto-build $filter. Recommended for LLMs. Tip: for lookups prefer GUID in *_Id, or use navigation Field/Name.',
	);

const readInputShape = {
	entity: z
		.string()
		.min(1)
		.describe(
			'Creatio OData entity set to query (e.g., Contact, Account, Activity). Tip: call "list-entities" first, then "describe-entity" to confirm fields before reading.',
		),
	filter: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			z.string().min(1).optional(),
		)
		.describe(
			"OData $filter clause. Use single quotes for strings and escape embedded ' as ''. Operators: eq, ne, gt, ge, lt, le, and, or, not, contains, startswith, endswith. Example: contains(Name,'Acme') and IsActive eq true. Lookup tips: prefer FieldId eq guid'...' (fast); or use navigation Field/Name eq '...'. LLM recipe (lookup by display value): (1) call 'describe-entity' for the base entity (e.g., Contact) and find a '<Field>Id' (e.g., TypeId); (2) infer navigation '<Field>' (e.g., Type) and use '<Field>/Name eq '<Value>'' (e.g., Type/Name eq 'Employee'); (3) optionally add $select and $expand to return the display name.",
		),
	filters: filtersShape
		.optional()
		.describe(
			"Alternative to raw $filter: structured 'filters' (LLM-friendly). Example: { all:[{ field:'TypeId', op:'eq', value:'<GUID>' }], any:[{ field:'Type/Name', op:'eq', value:'Employee' }] }",
		),
	select: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe(
			"Fields to return. Strongly recommended for performance. Example: ['Id','Name','Email']. Use 'describe-entity' to discover field names.",
		),
	top: z.coerce
		.number()
		.int()
		.positive()
		.max(1000)
		.optional()
		.describe('Max rows to return (suggest 25\u2013200 for responsiveness).'),
} as const;
export const readInput = z.object(readInputShape);

export const readDescriptor = makeToolDescriptor({
	title: 'Read records in Creatio',
	description:
		"Query Creatio records from an entity set. Recommended flow: (1) call 'list-entities' \u2192 (2) call 'describe-entity' to inspect fields \u2192 (3) call 'read' with a focused $select and optional $filter/$top. LLM playbook for lookups: If the user asks 'find contacts with type employee' \u2014 (a) describe 'Contact' and locate 'TypeId'; (b) use navigation 'Type/Name eq 'Employee''; (c) if GUID is known, prefer 'TypeId eq guid'...''. You may also use structured 'filters': { all:[{ field:'Type/Name', op:'eq', value:'Employee' }] }.",
	inputShape: readInputShape,
});

const createInputShape = {
	entity: z
		.string()
		.min(1)
		.describe(
			'Entity set to create a record in (e.g., Contact, Account). Tip: use "describe-entity" to find required fields and types before creating.',
		),
	data: z
		.record(z.string(), z.any())
		.describe(
			'Field map for new record. Dates in ISO 8601; booleans true/false; lookups as GUIDs in *_Id fields (e.g., AccountId). Prefer minimal fields required by the schema.',
		),
} as const;
export const createInput = z.object(createInputShape);

export const createDescriptor = makeToolDescriptor({
	title: 'Create record in Creatio',
	description:
		"Create a single Creatio record. Use 'describe-entity' first to verify required fields and types. Examples:\n- entity=Activity, data={ Title:'Call with Andrii', StartDate:'2025-09-12T12:00:00Z' }\n- entity=Account, data={ Name:'Acme UA', Code:'ACM-001' }",
	inputShape: createInputShape,
});

const updateInputShape = {
	entity: z.string().min(1).describe('Entity set to update (e.g., Contact, Account).'),
	id: z
		.string()
		.min(1)
		.describe(
			'Primary key of the record. Pass GUIDs as-is (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Non-GUID strings will be quoted automatically.',
		),
	data: z
		.record(z.string(), z.any())
		.describe('Partial fields to change. Only include properties that should be updated.'),
} as const;
export const updateInput = z.object(updateInputShape);

export const updateDescriptor = makeToolDescriptor({
	title: 'Update record in Creatio',
	description:
		"Update a single record by Id (PATCH). Example:\n- entity=Account, id='<GUID>', data={ Name:'Acme Europe' }\nUse 'describe-entity' beforehand to ensure field names and types are valid.",
	inputShape: updateInputShape,
});

const deleteInputShape = {
	entity: z.string().min(1).describe('Entity set to delete from (e.g., Contact, Account).'),
	id: z
		.string()
		.min(1)
		.describe(
			'Primary key of the record to delete. GUIDs can be passed as-is; non-GUID strings will be quoted automatically.',
		),
} as const;
export const deleteInput = z.object(deleteInputShape);

export const deleteDescriptor = makeToolDescriptor({
	title: 'Delete record in Creatio',
	description:
		'Delete a single record by Id. Consider soft-delete (via update of status flags) when appropriate.',
	inputShape: deleteInputShape,
});

export const listEntitiesInput = z.object({});

export const listEntitiesDescriptor = makeToolDescriptor({
	title: 'Get entities from Creatio',
	description:
		'Return all available Creatio OData entity sets. Start here, then use "describe-entity" to inspect fields and keys before performing CRUD.',
	inputShape: {},
});

const describeEntityInputShape = {
	entitySet: z
		.string()
		.min(1)
		.describe(
			'Entity set name to describe (e.g., Contact, Account). Returns entity type, key fields, and properties with types/nullable. Use this to plan subsequent read/create/update/delete.',
		),
} as const;
export const describeEntityInput = z.object(describeEntityInputShape);

export const describeEntityDescriptor = makeToolDescriptor({
	title: 'Get entity description from Creatio',
	description:
		'Inspect schema for the given entity set: entity type, primary key(s), and properties with types/nullable. Use this before CRUD to avoid invalid fields.',
	inputShape: describeEntityInputShape,
});

const searchInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Free-text search query. The server will look up common entities (e.g., Contact, Account, Activity) using contains(Name, <query>) and return top matches.',
		),
} as const;
export const searchInput = z.object(searchInputShape);

export const searchDescriptor = makeToolDescriptor({
	title: 'Search in Creatio',
	description:
		'Lightweight search across common entities (e.g., Contact, Account, Activity). Returns an array of {id, title, url}. The "id" is formatted as "EntitySet:GUID" and is consumable by the "fetch" tool. Note: Provided primarily for OpenAI GPT Connector MCP compatibility.',
	inputShape: searchInputShape,
});

const fetchInputShape = {
	id: z
		.string()
		.min(1)
		.describe(
			'Unique identifier of the search result to fetch. Format: "EntitySet:GUID" (e.g., "Contact:3f2e...").',
		),
} as const;
export const fetchInput = z.object(fetchInputShape);

export const fetchDescriptor = makeToolDescriptor({
	title: 'Fetch by id from Creatio',
	description:
		'Retrieve a full record by an id in the form "EntitySet:GUID" (e.g., "Contact:c4ed336c-..."). Returns { id, title, text, url, metadata } suitable for display. Note: Provided primarily for OpenAI GPT Connector MCP compatibility.',
	inputShape: fetchInputShape,
});

const executeProcessInputShape = {
	processName: z
		.string()
		.min(1)
		.describe(
			'REQUIRED: Schema name of the Creatio business process (e.g., "RunActualizeProcess").\n' +
				'IMPORTANT: This parameter accepts ONLY schema names, NOT display names/captions.\n' +
				'If user provides a display name/caption (e.g., "Actualize Process"), you MUST first use the "read" tool to find the corresponding schema name in VwProcessLib table:\n' +
				"- Use filter: contains(Caption,'user_provided_name')\n" +
				'- Select fields: ["Name", "Caption"]\n' +
				'- Use the "Name" field value as processName parameter.',
		),
	parameters: z
		.record(z.any())
		.optional()
		.describe(
			'Parameters to pass to the business process as key-value pairs. Parameter names typically start with uppercase letter. Examples:\n' +
				'- ContactId: "2ad0270b-dc4c-4fbf-9219-df32ce4c34fc" (GUID values)\n' +
				'- Amount: 1000 (numeric values)\n' +
				'- Text: "SomeText" (string values)\n' +
				'- BoolParam: true (boolean values)\n' +
				'Common parameter patterns: ContactId, AccountId, OpportunityId, Amount, Description, etc.',
		),
} as const;
export const executeProcessInput = z.object(executeProcessInputShape);

export const executeProcessDescriptor = makeToolDescriptor({
	title: 'Execute Creatio Business Process',
	description:
		'Execute a Creatio CRM business process with optional parameters. This tool runs server-side business processes in Creatio platform.\n\n' +
		'WORKFLOW FOR LLM:\n' +
		'1. If user provides display name/caption (e.g., "Lead Qualification Process"):\n' +
		'   - First use "read" tool on VwProcessLib entity\n' +
		"   - Filter: contains(Caption,'user_provided_name')\n" +
		'   - Select: ["Name", "Caption"]\n' +
		'   - Use the "Name" field value as processName parameter\n' +
		'2. If user provides schema name directly (e.g., "UsrLeadQualificationProcess"):\n' +
		'   - Use it directly as processName parameter\n\n' +
		'Process Identification:\n' +
		'- This tool accepts ONLY schema names (e.g., "RunActualizeProcess")\n' +
		'- Schema names are technical identifiers stored in VwProcessLib.Name column\n' +
		'- Display names/captions are user-friendly names in VwProcessLib.Caption column\n\n' +
		'Parameters:\n' +
		'- Passed as object with key-value pairs\n' +
		'- Parameter names typically start with uppercase letter\n' +
		'- Supports all JSON types: strings, numbers, booleans, GUIDs\n\n' +
		'Common Parameter Patterns:\n' +
		'- Entity IDs: ContactId, AccountId, OpportunityId, LeadId, CaseId\n' +
		'- Amounts: Amount, Price, Sum, Cost\n' +
		'- Text fields: Description, Notes, Text, Comment, Title\n' +
		'- Flags: IsActive, IsCompleted, SendEmail, CreateActivity\n' +
		'- Dates: StartDate, EndDate, DueDate (ISO format)\n\n' +
		'Example:\n' +
		'{\n' +
		'  "processName": "Lead Management Process",\n' +
		'  "parameters": {\n' +
		'    "ContactId": "2ad0270b-dc4c-4fbf-9219-df32ce4c34fc",\n' +
		'    "Amount": 15000,\n' +
		'    "Description": "High priority lead",\n' +
		'    "SendNotification": true\n' +
		'  }\n' +
		'}\n\n' +
		'Uses Creatio ProcessEngineService.svc/Execute endpoint for execution.',
	inputShape: executeProcessInputShape,
});
