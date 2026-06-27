import { z } from 'zod';

const CRITICAL_WARNINGS = {
	FILTER_SELECT_SYNC:
		'⚠️ CRITICAL: When using $filter with $select:\n' +
		'- ALWAYS include filtered fields in $select array\n' +
		"- Example: filter by AccountId → select=['Id','AccountId',...]\n" +
		'- Creatio returns error "Column by path X not found" if field filtered but not selected\n' +
		'- This does NOT apply to expanded entities - those are separate',
	GUID_NO_QUOTES:
		'⚠️ IMPORTANT GUID SYNTAX:\n' +
		'- GUID fields (Id, AccountId, ContactId, etc.): NO quotes, NO guid prefix!\n' +
		'  ✅ CORRECT: AccountId eq 8ecab4a1-0ca3-4515-9399-efe0a19390bd\n' +
		"  ❌ WRONG: AccountId eq guid'...' or AccountId eq '...'\n" +
		"- String/Text fields: WITH single quotes! Example: Name eq 'John'\n" +
		"- Navigation properties: WITH single quotes! Example: Type/Name eq 'Employee'",
	TIME_CONVERSION:
		'⏰ TIME CONVERSION CRITICAL:\nWhen updating StartDate/DueDate, convert local time to UTC!',
	LOOKUP_NAVIGATION:
		'🔗 FILTERING BY A LOOKUP (related record) — use NAVIGATION, not the scalar FK:\n' +
		"- By name (best): Contact/Name eq 'Andrew Baker', Type/Name eq 'Employee'\n" +
		'- By id: Contact/Id eq <guid>  (GUID, no quotes)\n' +
		'- ❌ Do NOT filter the scalar `ContactId`/`OwnerId`/`AccountId` directly — Creatio OData 500s with "Column by path XxxId not found in schema".\n' +
		'- The primary key `Id eq <guid>` DOES work as-is (it is a real column, not a lookup).',
} as const;

const DATA_TYPES_DESC = {
	BASIC:
		'DATA TYPES:\n' +
		'- Strings: "John Doe", "john@example.com"\n' +
		'- Numbers: 1000, 25.99\n' +
		'- Booleans: true, false\n' +
		'- Dates: ISO 8601 format with Z for UTC: "2025-10-08T19:00:00Z"\n' +
		'- GUIDs (lookups): "8ecab4a1-0ca3-4515-9399-efe0a19390bd" (no quotes in value!)',
	LOOKUPS:
		'LOOKUP FIELDS:\n' +
		'- Use field name ending with Id: AccountId, ContactId, TypeId, etc.\n' +
		'- Value must be valid GUID from related entity\n' +
		'- Example: AccountId: "8ecab4a1-0ca3-4515-9399-efe0a19390bd"',
	DATES:
		'⏰ DATES & TIME:\n' +
		'- Always use UTC time with Z suffix\n' +
		'- Convert local time to UTC: subtract timezone offset\n' +
		'- Format: "YYYY-MM-DDTHH:mm:ssZ"\n' +
		'- Example: "2025-10-08T19:00:00Z" for 22:00 local (UTC+3)',
} as const;

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

const CREATIO_GUID_REGEX =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const creatioGuid = () => z.string().regex(CREATIO_GUID_REGEX, 'Must be a 36-character hex GUID');

const getCurrentUserInfoInputShape = {};
export const getCurrentUserInfoInput = z.object(getCurrentUserInfoInputShape);

export const getCurrentUserInfoDescriptor = makeToolDescriptor({
	title: '🔑 Get Current User Info - CALL THIS FIRST!',
	description:
		'⚠️⚠️⚠️ MANDATORY FIRST STEP ⚠️⚠️⚠️\n\n' +
		'🚨 YOU MUST CALL THIS TOOL FIRST before creating ANY Activity, Lead, Opportunity, Case, or other CRM record!\n\n' +
		'WHY CALL FIRST:\n' +
		'- Returns the ContactId needed for OwnerId and AuthorId fields\n' +
		'- Without this, you CANNOT create activities or CRM records correctly\n' +
		'- Activities MUST have valid OwnerId and AuthorId (both = ContactId)\n' +
		'- By default, ALL activities/leads/tasks are created FOR THE CURRENT USER\n\n' +
		'📋 REQUIRED WORKFLOW:\n' +
		'Step 1: Call get-current-user-info (no parameters) ← DO THIS NOW!\n' +
		'Step 2: Extract contactId from response\n' +
		'Step 3: Store contactId in memory for this conversation\n' +
		'Step 4: Use contactId as OwnerId and AuthorId in ALL create operations\n\n' +
		'Returns:\n' +
		'{\n' +
		'  "userId": "410006e1-ca4e-4502-a9ec-e54d922d2c00",\n' +
		'  "contactId": "76929f8c-7e15-4c64-bdb0-adc62d383727",  // ← SAVE THIS!\n' +
		'  "userName": "Current User",\n' +
		'  "cultureName": "en-US"\n' +
		'}\n\n' +
		'USE CASES (when to call):\n' +
		'✅ User asks to create activity/meeting/task/call → CALL THIS FIRST!\n' +
		'✅ User asks to create lead/opportunity/case → CALL THIS FIRST!\n' +
		'✅ User asks who they are → CALL THIS!\n' +
		'✅ Beginning of ANY CRM workflow → CALL THIS FIRST!\n' +
		'❌ Simple queries (read/search) → Not required\n\n' +
		'CRITICAL RULES:\n' +
		'- ContactId (NOT userId) goes into OwnerId/AuthorId fields\n' +
		"- Cache the ContactId - don't call repeatedly\n" +
		'- Default assumption: create records FOR current user\n' +
		'- Only change owner if user explicitly says "for [someone else]"\n\n' +
		'Example usage:\n' +
		'User: "Create a meeting for tomorrow"\n' +
		'YOU: 1) Call get-current-user-info\n' +
		'     2) Use contactId for OwnerId and AuthorId\n' +
		'     3) Create activity with those IDs',
	inputShape: getCurrentUserInfoInputShape,
});

const op = z.enum(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith', 'endswith']);

const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const baseCondition = z.object({
	field: z
		.string()
		.min(1)
		.describe(
			'Field to filter on. To filter by a linked record, use navigation: by name `Contact/Name` / `Type/Name`, or by id `Contact/Id`. ' +
				'A scalar lookup FK (`ContactId`, `OwnerId`, `AccountId`) with a GUID value is auto-rewritten to `<Lookup>/Id`. The primary key is `Id`.',
		),
});

const compareCondition = baseCondition.extend({
	op: op.describe(
		'Comparison operators: eq, ne, gt, ge, lt, le, contains, startswith, endswith.',
	),
	value: value.describe(
		'Value to compare with. GUIDs are emitted unquoted for Id/lookup paths; other strings are quoted/escaped automatically.',
	),
});

const inCondition = baseCondition.extend({
	in: z
		.array(z.union([z.string(), z.number(), z.boolean()]))
		.min(1)
		.describe('Set of values (expanded to an OR group). Lookup FK GUIDs are auto-navigated.'),
});

const condition = z.union([compareCondition, inCondition]);

const filtersShape = z
	.object({
		all: z
			.array(condition)
			.min(1)
			.optional()
			.describe(
				'All conditions (AND). Example: [{ field:"Stage/Name", op:"eq", value:"Presentation" }]',
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
		'Structured filters - alternative to raw $filter. Automatically handles OData syntax, escaping, GUID formatting, and lookup navigation.\n' +
			'Filter by a linked record via navigation (Contact/Name, Contact/Id) — or pass a scalar `ContactId` GUID and it is auto-rewritten to `Contact/Id`.\n\n' +
			'Examples:\n' +
			'- Lookup by name: { all:[{ field:"Contact/Name", op:"eq", value:"Andrew Baker" }] }\n' +
			'- Lookup by id: { all:[{ field:"ContactId", op:"eq", value:"60733efc-..." }] }\n' +
			'- Multiple AND: { all:[{ field:"IsActive", op:"eq", value:true }, { field:"Name", op:"contains", value:"John" }] }\n' +
			'- Multiple OR: { any:[{ field:"Status/Name", op:"eq", value:"Active" }, { field:"Status/Name", op:"eq", value:"Pending" }] }',
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
			'⚠️ OData backend ONLY — ignored when the DataService backend is active (the default). ' +
				'Prefer the structured `filters` parameter, which works on both backends.\n' +
				"OData $filter clause. Use single quotes for strings and escape embedded ' as ''.\n" +
				"Operators: eq, ne, gt, ge, lt, le, and, or, not. Functions: contains(F,'v'), startswith(F,'v'), endswith(F,'v'), length(F), day(F).\n\n" +
				CRITICAL_WARNINGS.GUID_NO_QUOTES +
				'\n\n' +
				CRITICAL_WARNINGS.LOOKUP_NAVIGATION +
				'\n\n' +
				'Examples:\n' +
				'- By primary Id: Id eq 8ecab4a1-0ca3-4515-9399-efe0a19390bd\n' +
				"- Lookup by name: Contact/Name eq 'Andrew Baker' (RECOMMENDED)\n" +
				'- Lookup by id (NAVIGATION): Contact/Id eq 8ecab4a1-0ca3-4515-9399-efe0a19390bd\n' +
				"- Text search: contains(Name,'Acme')\n" +
				"- Multiple: contains(Name,'Baker') and Type/Name eq 'Employee'\n\n" +
				'💡 BEST PRACTICE: prefer the structured `filters` parameter — it auto-rewrites lookup `XxxId` filters to the required `Xxx/Id` navigation for you.',
		),
	filters: filtersShape
		.optional()
		.describe(
			'Structured filters (alternative to raw $filter). Handles OData syntax, GUID formatting, and lookup navigation automatically.\n\n' +
				CRITICAL_WARNINGS.LOOKUP_NAVIGATION +
				'\n(With this structured parameter you can pass either form — a `XxxId` field with a GUID value is auto-rewritten to `Xxx/Id`.)\n\n' +
				'Examples:\n' +
				"- Lookup by name: { all:[{ field:'Contact/Name', op:'eq', value:'Andrew Baker' }] } (RECOMMENDED)\n" +
				"- Lookup by id: { all:[{ field:'ContactId', op:'eq', value:'60733efc-f36b-1410-a883-16d83cab0980' }] }  // becomes Contact/Id eq <guid>\n" +
				"- Multiple AND: { all:[{ field:'IsActive', op:'eq', value:true }, { field:'Name', op:'contains', value:'John' }] }\n" +
				"- Multiple OR: { any:[{ field:'Stage/Name', op:'eq', value:'Presentation' }, { field:'Stage/Name', op:'eq', value:'Negotiation' }] }",
		),
	select: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe(
			'Fields to return from the main entity. Strongly recommended for performance.\n\n' +
				'⚠️ IMPORTANT: $select works ONLY for direct properties of the entity!\n' +
				"- ✅ CORRECT: select=['Id','Name','AccountId','Email']\n" +
				"- ❌ WRONG: select=['Account/Name'] - navigation paths NOT supported\n\n" +
				CRITICAL_WARNINGS.FILTER_SELECT_SYNC +
				'\n\n' +
				'💡 TO GET RELATED DATA: Use expand parameter (RECOMMENDED)!\n' +
				"- expand=['Account'] loads full Account object automatically\n" +
				'- No need to include expanded fields in select\n' +
				'- Much better than making separate requests\n\n' +
				"Use 'describe-entity' to discover available field names.",
		),
	expand: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe(
			'⚠️ OData backend ONLY — ignored when the DataService backend is active (the default). ' +
				'With DataService, read related fields by dotted column path in `select`/`filters` (e.g. `Account.Name`).\n\n' +
				'Navigation properties to expand (load related entities in one request).\n\n' +
				'This is the OData $expand parameter. Loads related entity objects.\n' +
				'Very useful to get complete data without multiple requests!\n\n' +
				'✅ HOW TO USE:\n' +
				"- Find field ending with 'Id' (e.g., AccountId, ContactId, OwnerId)\n" +
				"- Remove 'Id' suffix to get navigation name: AccountId → Account\n" +
				"- Add to expand array: expand=['Account']\n\n" +
				'� EXAMPLES:\n' +
				"- Get orders with account info: expand=['Account']\n" +
				"- Get contacts with account info: expand=['Account']\n" +
				"- Multiple relations: expand=['Account','Owner']\n" +
				"- Nested expansion: expand=['Account($expand=PrimaryContact)']\n\n" +
				'💡 EXAMPLE REQUEST:\n' +
				"  entity: 'Order'\n" +
				"  expand: ['Account']\n" +
				"  select: ['Id','Number','Amount','AccountId']\n" +
				'Result includes full Account object with all its fields for each order!\n\n' +
				'⚠️ NOTE: When combining $expand with $filter:\n' +
				'- Still include filtered fields in select if using $select\n' +
				'- Expanded entities are added to response, not to select',
		),
	orderBy: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			z.string().optional(),
		)
		.describe(
			'OData $orderby clause for sorting results.\n\n' +
				'Syntax: "FieldName asc" or "FieldName desc"\n' +
				'Multiple fields: "Field1 asc, Field2 desc"\n\n' +
				'✅ EXAMPLES:\n' +
				'- orderBy: "Name asc" - sort by name ascending\n' +
				'- orderBy: "CreatedOn desc" - newest first\n' +
				'- orderBy: "Amount desc" - highest amount first\n' +
				'- orderBy: "Name asc, Amount desc" - sort by multiple fields\n\n' +
				'⚠️ NOTE: You can only sort by direct properties of the entity.\n' +
				'Sorting by navigation properties (like Account/Name) is NOT supported in Creatio OData.',
		),
	top: z.coerce
		.number()
		.int()
		.min(0)
		.max(1000)
		.optional()
		.describe(
			'Max rows to return ($top). Defaults to 50 when omitted (so results are never unbounded); raise it or paginate with skip for more. Use top:0 with count:true for a count-only query. Suggest 25\u2013200.',
		),
	skip: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			'Offset pagination ($skip): skip this many matching rows before returning. ' +
				'Combine with top to page, e.g. page 3 of 25 \u2192 skip:50, top:25. ' +
				'Pair with a stable orderBy so pages do not overlap.',
		),
	count: z
		.boolean()
		.optional()
		.describe(
			'When true, also return the TOTAL number of matching records ($count=true), ignoring top/skip. ' +
				'The response shape becomes { total, value } instead of a bare array.\n' +
				'\ud83d\udca1 For a COUNT-ONLY question ("how many opportunities does X have"), set count:true AND top:0 \u2014 ' +
				'you get { total: N, value: [] } in one request instead of fetching rows. ' +
				'Filter the same way as a normal read (e.g. lookups via ContactId \u2192 auto Contact/Id).',
		),
} as const;
/** Which optional read params the active CRUD backend supports (mirrors CrudCapabilities). */
export interface ReadCapabilities {
	rawFilter: boolean;
	expand: boolean;
}

// Split the full read shape into the always-portable fields and the OData-only escape
// hatches (raw `filter` string, `expand`), so each backend registers only the parameters it
// actually honors instead of advertising dead options.
const { filter: odataFilterField, expand: odataExpandField, ...neutralReadShape } = readInputShape;

export function buildReadInputShape(caps: ReadCapabilities) {
	return {
		...neutralReadShape,
		...(caps.rawFilter ? { filter: odataFilterField } : {}),
		...(caps.expand ? { expand: odataExpandField } : {}),
	};
}

export function buildReadInput(caps: ReadCapabilities) {
	return z.object(buildReadInputShape(caps));
}

export function buildReadDescriptor(caps: ReadCapabilities) {
	const advanced = caps.rawFilter
		? 'Advanced (OData backend): a raw `filter` string and `expand` are also available. '
		: '';
	return makeToolDescriptor({
		title: 'Read records in Creatio',
		description:
			'Query Creatio records. Workflow: 1) list-entities 2) describe-entity 3) read with select, filters, orderBy, top. ' +
			'Key params: select (fields to return), filters (conditions — recommended), orderBy (sorting), top (limit), skip (pagination offset), count (return total). ' +
			'Always include fields used in filters in select when select is provided. ' +
			'Filter related records via navigation (Contact/Name, Contact/Id) — a scalar lookup `XxxId` with a GUID is handled for you. ' +
			advanced +
			'Paginate with skip+top (+ a stable orderBy). To COUNT, set count:true (response becomes { total, value }); for count-only use count:true + top:0. ' +
			'For date/time filtering see /datetime-guide prompt. For Contact/Owner filtering see /contactid-guide prompt. ' +
			"Examples: entity:'Order', select:['Id','Number','Amount'], filters:{ all:[{ field:'ContactId', op:'eq', value:'<guid>' }] }, orderBy:'Amount desc', top:25, skip:0. " +
			"count-only: entity:'Opportunity', filters:{ all:[{ field:'ContactId', op:'eq', value:'<guid>' }] }, count:true, top:0.",
		inputShape: buildReadInputShape(caps),
	});
}

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
			'Field map for new record.\n\n' +
				DATA_TYPES_DESC.BASIC +
				'\n\n' +
				DATA_TYPES_DESC.LOOKUPS +
				'\n\n' +
				DATA_TYPES_DESC.DATES +
				'\n\n' +
				"💡 TIP: Call 'describe-entity' first to see required fields and their types!",
		),
} as const;
export const createInput = z.object(createInputShape);

export const createDescriptor = makeToolDescriptor({
	title: 'Create record in Creatio',
	description:
		"Create a single Creatio record. Use 'describe-entity' first to confirm required fields & types. " +
		'Provide entity and data map. Only include fields you need. ' +
		'ALL DATE/TIME FIELDS: For ANY date/time field (StartDate, DueDate, RemindToOwnerDate, CreatedOn overrides, custom date columns) ALWAYS use /datetime-guide for UTC conversion & formatting. ' +
		'ALL CONTACT / USER LOOKUP FIELDS: For ANY field pointing to a user/contact (OwnerId, AuthorId, CreatedById, ModifiedById, ResponsibleId, ManagerId, SupervisorId, and similar *Id fields referencing sys users) use /contactid-guide to resolve correct ContactId. Avoid guessing IDs. ' +
		'🎯 DEFAULT OWNER/AUTHOR: Activities and tasks are ALWAYS created for the CURRENT USER by default! Set OwnerId and AuthorId to current user\'s ContactId (from get-current-user-info or SysAdminUnit.ContactId) unless user EXPLICITLY says "for [another person]". Don\'t ask "for whom?" - default to current user! ' +
		'Activities (Task/Meeting/Call/Email): HARD RULE → Always set TypeId to Task (fbe0acdc-cfc0-df11-b00f-001d60e938c6) and vary only ActivityCategoryId for meeting/call/email intent unless user explicitly says phrases like: "real meeting type", "true call type", "not a task", "use Visit type". Do NOT look up ActivityType for ordinary meeting/call/email requests. To intentionally allow a non-Task type, caller must add meta flag __allowNonTaskType=true. See /create-activity-guide prompt. ' +
		'Tagging: use /tagging-guide prompt. ' +
		"Examples: Account → data={ Name:'Acme Corp', Phone:'+1-234-567' }; Contact → data={ Name:'John Doe', Email:'john@example.com' }",
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
		.describe(
			'Partial fields to change. Only include properties that should be updated.\n\n' +
				DATA_TYPES_DESC.BASIC +
				' (same as create)\n\n' +
				DATA_TYPES_DESC.DATES +
				'\n\n' +
				'COMMON UPDATE SCENARIOS:\n' +
				'- Change Activity time: { StartDate: "2025-10-09T14:00:00Z" }\n' +
				'- Update status: { StatusId: "<GUID from ActivityStatus>" }\n' +
				'- Reschedule with reminder: { StartDate: "...", RemindToOwnerDate: "..." }\n' +
				'- Change account: { AccountId: "guid..." }\n\n' +
				'💡 For Activities: Query lookup tables (ActivityStatus, ActivityPriority) to get new IDs dynamically!',
		),
} as const;
export const updateInput = z.object(updateInputShape);

export const updateDescriptor = makeToolDescriptor({
	title: 'Update record in Creatio',
	description:
		'Update a record by Id (PATCH). Supply entity, id, and partial data containing only changed fields. ' +
		"Examples: Account → data={ Name:'Updated Name' }; Contact → data={ Email:'new@example.com' }. " +
		'DATE/TIME: For ANY date/time modifications (reschedule StartDate, set DueDate, reminders, custom date columns, CreatedOn override when allowed) consult /datetime-guide prompt (always send UTC). ' +
		'CONTACT/USER FIELDS: When changing OwnerId, AuthorId, ModifiedById (rare), ResponsibleId, ManagerId, etc use /contactid-guide prompt to resolve valid ContactId. Do NOT invent or reuse unrelated IDs. ' +
		'Activities: /create-activity-guide prompt (overall), /datetime-guide prompt (time changes), /contactid-guide prompt (participants/Owner).',
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
		'Delete a single record by Id.\n\n' +
		'⚠️ ALWAYS confirm with user before deleting!\n' +
		'1. Show what will be deleted (entity, ID, identifying info)\n' +
		'2. Ask: "Are you sure you want to delete this record?"\n' +
		'3. Wait for explicit confirmation\n\n' +
		'💡 SAFER ALTERNATIVE - Soft Delete:\n' +
		'Instead of permanent deletion, update status: IsActive=false, IsDeleted=true\n' +
		"Example: Use 'update' tool with data={ IsActive: false }",
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
		'Inspect schema for the given entity set: entity type, primary key(s), and properties with types/nullable. Use this before CRUD to avoid invalid fields. ' +
		'When DataForge is enabled on the environment, this tool transparently returns the richer DataForge column details (`source:"dataforge"`); otherwise it falls back to exact OData $metadata (`source:"odata"`). Behaviour and inputs are identical either way.',
	inputShape: describeEntityInputShape,
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
		.record(z.string(), z.any())
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
		'GUID & Date Helpers: /datetime-guide prompt applies to EVERY date/time parameter (convert to UTC). /contactid-guide prompt applies to EVERY user/contact participant parameter (OwnerId, AuthorId, AssigneeId, ResponsibleId, CreatedById overrides, etc).\n\n' +
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

const querySysSettingsInputShape = {
	sysSettingCodes: z
		.array(z.string().min(1))
		.min(1)
		.describe(
			'List of system setting codes to query. Provide at least one Creatio sys setting code (e.g., "EmailDefSendName", "SupportEmail").',
		),
} as const;

export const querySysSettingsInput = z.object(querySysSettingsInputShape);

export const querySysSettingsDescriptor = makeToolDescriptor({
	title: 'Query system settings in Creatio',
	description:
		'Retrieve the current values and metadata for one or more Creatio system settings using the QuerySysSettings endpoint. Returns the raw response including success flag, values map, and notFoundSettings array (if any).',
	inputShape: querySysSettingsInputShape,
});

const SYS_SETTING_VALUE_TYPE_DESC =
	'Creatio data value type name. See /sys-settings-guide prompt for the table of supported valueTypeName values (Binary, Boolean, DateTime, etc.) and always send the raw value string.';

const SYS_SETTING_REFERENCE_SCHEMA_DESC =
	'EntitySchema UId for lookup system settings. Required only when valueTypeName="Lookup". See /sys-settings-guide prompt for the recommended VwWorkspaceObjects query to retrieve this UId.';

const sysSettingDefinitionFieldShape = {
	code: z
		.string()
		.min(1)
		.describe(
			'Unique system setting code (e.g., "TestSetting"). Must follow Creatio naming rules.',
		),
	name: z.string().min(1).describe('Display name rendered in Creatio UI (e.g., "Test setting").'),
	valueTypeName: z.string().min(1).describe(SYS_SETTING_VALUE_TYPE_DESC),
	description: z.string().optional(),
	isCacheable: z.boolean().optional(),
	isPersonal: z.boolean().optional(),
	isSSPAvailable: z.boolean().optional(),
	referenceSchemaUId: z.string().optional().describe(SYS_SETTING_REFERENCE_SCHEMA_DESC),
	dataValueType: z.union([z.string(), z.number()]).optional(),
} as const;

const sysSettingDefinitionSchema = z.object(sysSettingDefinitionFieldShape);

const createSysSettingDefinitionSchema = sysSettingDefinitionSchema.extend({
	id: creatioGuid()
		.optional()
		.describe('Optional GUID for the sys setting record. Auto-generated when omitted.'),
});

const updateSysSettingDefinitionSchema = sysSettingDefinitionSchema.partial().extend({
	code: sysSettingDefinitionFieldShape.code,
	name: sysSettingDefinitionFieldShape.name,
	valueTypeName: sysSettingDefinitionFieldShape.valueTypeName,
});

const createSysSettingInputShape = {
	definition: createSysSettingDefinitionSchema,
	initialValue: z
		.any()
		.optional()
		.describe('Optional initial value to write immediately after creating the system setting.'),
} as const;

export const createSysSettingInput = z.object(createSysSettingInputShape);

export const createSysSettingDescriptor = makeToolDescriptor({
	title: 'Create a new system setting in Creatio',
	description:
		'Creates a brand-new system setting (metadata record) using InsertSysSettingRequest and optionally assigns an initial value via PostSysSettingsValues. For full guidance on supported valueTypeName strings and lookup reference resolution, see the /sys-settings-guide prompt.',
	inputShape: createSysSettingInputShape,
});

const setSysSettingsValueInputShape = {
	sysSettingsValues: z
		.record(z.string(), z.any())
		.describe(
			'Map of system setting codes to their new values. Accepts any JSON-compatible types (string, number, boolean, object, array).\n\n' +
				'Examples:\n' +
				"- Single setting: { 'SettingCode': 'value' }\n" +
				"- Multiple settings: { 'SettingCode1': 'value1', 'SettingCode2': 123, 'SettingCode3': true }\n" +
				"- Mixed types: { 'EmailEnabled': true, 'MaxRetries': 5, 'ApiKey': 'secret' }",
		),
} as const;

export const setSysSettingsValueInput = z.object(setSysSettingsValueInputShape);

export const setSysSettingsValueDescriptor = makeToolDescriptor({
	title: 'Set system settings values in Creatio',
	description:
		'Update one or more system settings in Creatio in a single request.\n\n' +
		'Parameters:\n' +
		'- sysSettingsValues: A map/object of system setting codes to their new values. Supports any JSON-compatible types (string, number, boolean, object, array).\n\n' +
		'USAGE:\n' +
		'- Update single setting: { "SettingCode": "value" }\n' +
		'- Update multiple settings at once: { "SettingCode1": "value1", "SettingCode2": 123, "SettingCode3": true }\n' +
		'- Mixed data types: { "EmailEnabled": true, "MaxRetries": 5, "ApiKey": "secret" }\n\n' +
		'Returns the result from the system settings update endpoint.',
	inputShape: setSysSettingsValueInputShape,
});

const updateSysSettingDefinitionInputShape = {
	id: creatioGuid().describe('Existing SysSetting Id (Guid) to update.'),
	definition: updateSysSettingDefinitionSchema.describe(
		'Creatio requires Code, Name, and valueTypeName on every UpdateSysSettingRequest. Always include those fields (existing values are OK) plus any other properties that need updating.',
	),
} as const;

export const updateSysSettingDefinitionInput = z.object(updateSysSettingDefinitionInputShape);

export const updateSysSettingDefinitionDescriptor = makeToolDescriptor({
	title: 'Update existing system setting definition',
	description:
		'Calls the UpdateSysSettingRequest endpoint to modify metadata such as name, description, valueTypeName, cache flags, personalization flags, and lookup reference schema. IMPORTANT: Creatio validates that Code, Name, and valueTypeName are present on every update, even if they are unchanged—copy the current values when needed. See the /sys-settings-guide prompt for allowed value types and lookup resolution tips.',
	inputShape: updateSysSettingDefinitionInputShape,
});

const refreshFeatureCacheInputShape = {
	featureCode: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Optional feature code (e.g., "FreedomUIComposableApp"). When provided, only that feature\'s cache is invalidated for all users. Omit to clear the cache for every feature.',
		),
} as const;

export const refreshFeatureCacheInput = z.object(refreshFeatureCacheInputShape);

export const refreshFeatureCacheDescriptor = makeToolDescriptor({
	title: 'Refresh Creatio feature toggle cache',
	description:
		'Invalidates the in-memory feature-toggle cache for all users. Call this after changing rows in `Feature` or `AdminUnitFeatureState` via the standard create/update/delete tools so the new state becomes visible. Pass `featureCode` to scope to a single feature; omit to refresh all. See /feature-toggle-guide for the full workflow.',
	inputShape: refreshFeatureCacheInputShape,
});

const upsertAdminOperationInputShape = {
	id: creatioGuid()
		.optional()
		.describe(
			'Existing SysAdminOperation Id. Omit to create a new record (a new GUID is generated server-side and returned in the response).',
		),
	name: z
		.string()
		.min(1)
		.describe(
			'Display name of the system operation (e.g., "Can manage administration"). Required for both create and update.',
		),
	code: z
		.string()
		.min(1)
		.describe(
			'Code of the system operation (e.g., "CanManageAdministration"). Required and must be unique. Conventionally PascalCase with no spaces.',
		),
	description: z
		.string()
		.optional()
		.describe('Optional human-readable description of what the operation gates.'),
} as const;

export const upsertAdminOperationInput = z.object(upsertAdminOperationInputShape);

export const upsertAdminOperationDescriptor = makeToolDescriptor({
	title: 'Create or update Creatio system operation',
	description:
		'Create a new `SysAdminOperation` (omit `id`) or update an existing one (supply `id`). Use this instead of the generic create/update tools — OData modifications on `SysAdminOperation` are blocked at the platform level. Reads still go through the standard `read` tool. Response contains the operation Id. See /admin-operation-guide for the full workflow.',
	inputShape: upsertAdminOperationInputShape,
});

const deleteAdminOperationInputShape = {
	ids: z
		.array(creatioGuid())
		.min(1)
		.describe(
			'List of SysAdminOperation Ids to delete (RightsService deletes them and their related grantee rows). Use the standard `read` tool on `SysAdminOperation` to look up Ids by Code first.',
		),
} as const;

export const deleteAdminOperationInput = z.object(deleteAdminOperationInputShape);

export const deleteAdminOperationDescriptor = makeToolDescriptor({
	title: 'Delete Creatio system operations',
	description:
		'Delete one or more `SysAdminOperation` rows by Id. Related grantee rows are cleaned up automatically. Use this instead of the generic `delete` tool — OData modifications on `SysAdminOperation` are blocked at the platform level.',
	inputShape: deleteAdminOperationInputShape,
});

const setAdminOperationGranteeInputShape = {
	adminOperationId: creatioGuid().describe(
		'Id of the SysAdminOperation being granted or revoked. Look up via `read` on `SysAdminOperation` filtered by Code.',
	),
	adminUnitIds: z
		.array(creatioGuid())
		.min(1)
		.describe(
			'SysAdminUnit Ids (users or roles) that should receive the same grant/revoke state. Resolve via `read` on `SysAdminUnit` filtered by Name. Use SysAdminUnit.Id (NOT ContactId).',
		),
	canExecute: z
		.boolean()
		.describe(
			'`true` grants the operation (allow) to every listed admin unit; `false` revokes it (deny).',
		),
} as const;

export const setAdminOperationGranteeInput = z.object(setAdminOperationGranteeInputShape);

export const setAdminOperationGranteeDescriptor = makeToolDescriptor({
	title: 'Grant or revoke a system operation for users/roles',
	description:
		'Grant (`canExecute=true`) or revoke (`canExecute=false`) a system operation for one or more `SysAdminUnit` ids (users or roles). Repeated calls for the same (operation, unit) pair update the existing grant row instead of duplicating. Use this instead of the generic create/update tools — OData modifications on `SysAdminOperationGrantee` are blocked.',
	inputShape: setAdminOperationGranteeInputShape,
});

const deleteAdminOperationGranteeInputShape = {
	ids: z
		.array(creatioGuid())
		.min(1)
		.describe(
			'List of SysAdminOperationGrantee row Ids to delete. Look them up via `read` on `SysAdminOperationGrantee` filtered by `SysAdminOperationId` and/or `SysAdminUnitId`.',
		),
} as const;

export const deleteAdminOperationGranteeInput = z.object(deleteAdminOperationGranteeInputShape);

export const deleteAdminOperationGranteeDescriptor = makeToolDescriptor({
	title: 'Remove specific system operation grant rows',
	description:
		'Delete individual grant rows by Id when you want to remove a grant entry entirely. To flip allow ↔ deny instead, prefer `set-admin-operation-grantee`.',
	inputShape: deleteAdminOperationGranteeInputShape,
});

const SERVICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const callConfigurationServiceInputShape = {
	service: z
		.string()
		.regex(SERVICE_NAME_PATTERN, 'Service name must match ^[A-Za-z][A-Za-z0-9_-]*$')
		.describe(
			'Configuration service name as registered in Creatio (e.g., "RightsService"). The full URL is /0/rest/<service>/<method>.',
		),
	method: z
		.string()
		.regex(SERVICE_NAME_PATTERN, 'Method name must match ^[A-Za-z][A-Za-z0-9_-]*$')
		.describe('Service method name (UriTemplate) to invoke (e.g., "UpsertAdminOperation").'),
	httpMethod: z
		.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
		.default('POST')
		.describe('HTTP method. Most Creatio configuration services use POST.'),
	body: z
		.record(z.string(), z.any())
		.optional()
		.describe(
			'Request body sent as JSON for POST/PATCH/PUT. Ignored for GET/DELETE. Pass the service parameters as a flat object (e.g., {"recordId":"<guid>","name":"..."}). Creatio configuration services use [WebInvoke BodyStyle=Wrapped], so each parameter becomes a top-level key.',
		),
	query: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional()
		.describe('Optional query-string parameters appended to the URL.'),
} as const;

export const callConfigurationServiceInput = z.object(callConfigurationServiceInputShape);

export const callConfigurationServiceDescriptor = makeToolDescriptor({
	title: 'Call a Creatio configuration REST service method',
	description:
		'Escape hatch for invoking any configuration-package REST service exposed at /0/rest/<service>/<method>. Use this when no dedicated MCP tool covers the operation. Always prefer the specific tools (`upsert-admin-operation`, `refresh-feature-cache`, sys-settings tools, etc.) when they exist — they validate inputs, handle wrapped responses, and document side effects. Returns `{status, contentType, body}`; JSON responses are auto-parsed.',
	inputShape: callConfigurationServiceInputShape,
});

// ---------------------------------------------------------------------------
// DataForge — AI-oriented semantic discovery over the Creatio data model.
//
// These tools call the Creatio-hosted DataForge read API
// (POST /0/rest/DataForgeSchemaReadService/<method>) which forwards to the
// remote DataForge microservice. They COMPLEMENT, and do not replace,
// `list-entities`/`describe-entity`:
//   • describe-entity = authoritative, exact OData $metadata (always available,
//     needs the exact entity name) → use it to confirm fields before CRUD.
//   • DataForge       = fuzzy / semantic discovery (natural-language → table),
//     relationship pathing, and lookup-value search (needs DataForge configured
//     and synced) → use it to FIND the right table/columns/values first.
// Typical chain: dataforge-similar-tables → describe-entity → read/create.
//
// Requires the MCP user to have the `CanReadDataStructureColumnDetails`
// operation, and DataForge to be enabled on the environment
// (DataForgeServiceUrl + IdentityServer settings). Use `dataforge-status` to
// verify it is online and the data/lookups are synced.
// ---------------------------------------------------------------------------

const DATAFORGE_PREREQ_NOTE =
	'\n\nPrerequisites: DataForge must be enabled on this environment (DataForgeServiceUrl + IdentityServer settings) and the MCP user needs the `CanReadDataStructureColumnDetails` operation. ' +
	'Run `dataforge-status` first if you are unsure whether DataForge is online. Returns `{status, contentType, body}`; on a disabled/misconfigured service `body.Success` is false with an `ErrorInfo`.';

const dataforgeSimilarTablesInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Natural-language description of the data you are looking for (e.g. "customer support tickets", "продажі по угодах"). DataForge returns the table names that best match the meaning, not an exact text match.',
		),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(200)
		.optional()
		.describe('Optional max number of candidate tables to return (server default ~50).'),
} as const;
export const dataforgeSimilarTablesInput = z.object(dataforgeSimilarTablesInputShape);

export const dataforgeSimilarTablesDescriptor = makeToolDescriptor({
	title: 'DataForge: find tables by meaning',
	description:
		'Semantic search for Creatio tables/entities from a natural-language query. ' +
		'Use this FIRST when you do not know which entity holds the data the user is talking about — it maps a concept to candidate table names. ' +
		'Then call `describe-entity` on the chosen table to get the authoritative field list before reading/creating.' +
		DATAFORGE_PREREQ_NOTE,
	inputShape: dataforgeSimilarTablesInputShape,
});

const dataforgeTableDetailsInputShape = {
	query: z
		.string()
		.min(1)
		.describe('Natural-language query describing the table(s) you want detailed info about.'),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(200)
		.optional()
		.describe('Optional max number of tables to return with details.'),
} as const;
export const dataforgeTableDetailsInput = z.object(dataforgeTableDetailsInputShape);

export const dataforgeTableDetailsDescriptor = makeToolDescriptor({
	title: 'DataForge: matching tables with details',
	description:
		'Like `dataforge-similar-tables`, but returns richer per-table details (description/columns as known to DataForge) for the best semantic matches. ' +
		'For the canonical, exact field schema still confirm with `describe-entity` before CRUD.' +
		DATAFORGE_PREREQ_NOTE,
	inputShape: dataforgeTableDetailsInputShape,
});

const dataforgeTableRelationshipsInputShape = {
	sourceTable: z
		.string()
		.min(1)
		.describe(
			'Source table/entity name (e.g. "Contact"). Resolve it via dataforge-similar-tables if unsure.',
		),
	targetTable: z.string().min(1).describe('Target table/entity name (e.g. "Account").'),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(50)
		.optional()
		.describe('Optional max number of relationship paths to return (server default ~5).'),
	bidirectional: z
		.boolean()
		.optional()
		.describe('Search relationships in both directions. Defaults to true server-side.'),
	skipDetails: z
		.boolean()
		.optional()
		.describe('Return only the path without extra column-level detail.'),
} as const;
export const dataforgeTableRelationshipsInput = z.object(dataforgeTableRelationshipsInputShape);

export const dataforgeTableRelationshipsDescriptor = makeToolDescriptor({
	title: 'DataForge: how two tables are related',
	description:
		'Find the relationship path(s) between two Creatio tables (which columns/joins connect them). ' +
		'Use this to figure out how to `$expand` or join entities in a `read`, or to understand the data model around an entity.' +
		DATAFORGE_PREREQ_NOTE,
	inputShape: dataforgeTableRelationshipsInputShape,
});

const dataforgeLookupValuesInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Natural-language / partial text to match lookup values against (e.g. "in progress", "VIP").',
		),
	schemaName: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Optional lookup schema/entity name to restrict the search to a single lookup (e.g. "CaseStatus").',
		),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Optional max number of lookup values to return (server default ~5).'),
} as const;
export const dataforgeLookupValuesInput = z.object(dataforgeLookupValuesInputShape);

export const dataforgeLookupValuesDescriptor = makeToolDescriptor({
	title: 'DataForge: find lookup values by meaning',
	description:
		'Fuzzy/semantic search for lookup values across (or within) Creatio lookups — returns matching values and their identifiers. ' +
		'Useful to resolve a human phrase ("high priority", "закрита угода") to the correct lookup record Id to use in a filter or create/update payload.' +
		DATAFORGE_PREREQ_NOTE,
	inputShape: dataforgeLookupValuesInputShape,
});

export const dataforgeStatusInput = z.object({});

export const dataforgeStatusDescriptor = makeToolDescriptor({
	title: 'DataForge: service status / is it enabled',
	description:
		'Check whether DataForge is enabled and healthy on this environment. ' +
		'Calls DataForgeMaintenanceService.GetServiceStatus and returns `{ IsOnline, Liveness, Readiness, DataStructureReadiness, LookupsReadinessInfo }`. ' +
		'Interpretation: IsOnline=false → DataForge is unreachable or DataForgeServiceUrl is not configured (the other dataforge-* tools will fail). ' +
		'Readiness.HttpStatusCode=200 with non-empty DataStructureReadiness/LookupsReadinessInfo → the data model and lookups have been synced and search will return results. ' +
		'If you only need a quick on/off signal, you can also query the `DataForgeServiceUrl` system setting (empty = disabled).',
	inputShape: {},
});

// ---------------------------------------------------------------------------
// Global Search — Creatio's cross-entity record search (Elasticsearch-backed),
// the same engine behind the UI search box. Registered only when Global Search
// is enabled on the environment (non-empty `GlobalSearchUrl`).
// ---------------------------------------------------------------------------

const globalSearchInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Free-text search across indexed records, exactly like the Creatio UI search box (e.g. "andrew baker", "acme invoice 2024"). Matches names, numbers and other indexed columns.',
		),
	entities: z
		.array(z.string().min(1))
		.optional()
		.describe(
			'Optional list of entity schema names to restrict the search to (e.g. ["Contact","Account"]). Omit to search all indexed sections. Maps to the service `type` filter.',
		),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Max records to return (server default ~15).'),
	from: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.describe('Pagination offset (skip this many results). Use with the response `nextFrom`.'),
} as const;
export const globalSearchInput = z.object(globalSearchInputShape);

export const globalSearchDescriptor = makeToolDescriptor({
	title: 'Global Search: find records across entities',
	description:
		'Search Creatio records the way the UI search box does — full-text across all indexed entities (Elasticsearch-backed). ' +
		'Use this to locate specific records by name/number/keyword when you do not know the exact entity or filter (e.g. "find Andrew Baker", "the Acme renewal opportunity"). ' +
		'Calls GlobalSearchService.Search; returns matched records with `entityName`, `id`, `columnValues`, and highlighted `foundColumns`, plus `total`/`nextFrom` for paging. ' +
		'Differs from `read`: `read` needs an exact entity + OData filter; global-search is fuzzy and cross-entity. ' +
		'Prerequisites: Global Search must be enabled on the environment (non-empty `GlobalSearchUrl` + the `GlobalSearch_V2` feature). This tool is only registered when enabled.',
	inputShape: globalSearchInputShape,
});
