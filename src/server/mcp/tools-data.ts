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
		'  "userName": "Supervisor",\n' +
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
		'Structured filters - alternative to raw $filter. Automatically handles OData syntax, escaping, etc.\n' +
			'Tip: For lookups, prefer navigation properties (Field/Name) over IDs for better readability.\n\n' +
			'Examples:\n' +
			'- Lookup by name: { all:[{ field:"Type/Name", op:"eq", value:"Employee" }] }\n' +
			'- By GUID: { all:[{ field:"TypeId", op:"eq", value:"60733efc-..." }] }\n' +
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
			"OData $filter clause. Use single quotes for strings and escape embedded ' as ''.\n" +
				'Operators: eq, ne, gt, ge, lt, le, and, or, not, contains, startswith, endswith.\n\n' +
				CRITICAL_WARNINGS.GUID_NO_QUOTES +
				'\n\n' +
				'⚠️ IMPORTANT: When using $filter with $select:\n' +
				'- Include ALL fields from filter in $select if possible\n' +
				'- Example: filter by AccountId? Include AccountId in select array\n' +
				'- Creatio may fail if filtered field is not in select list\n\n' +
				'Examples:\n' +
				'- By GUID: AccountId eq 8ecab4a1-0ca3-4515-9399-efe0a19390bd\n' +
				"- Text search: contains(Name,'Acme')\n" +
				"- Multiple: contains(Name,'Baker') and IsActive eq true\n" +
				"- Lookup by name: Type/Name eq 'Employee' (RECOMMENDED!)\n\n" +
				'💡 BEST PRACTICE: Use structured filters parameter instead of raw $filter - it handles syntax automatically!',
		),
	filters: filtersShape
		.optional()
		.describe(
			'Structured filters (alternative to raw $filter). Automatically handles proper OData syntax including GUID formatting.\n' +
				'System automatically removes quotes from GUID values for Id fields.\n\n' +
				'⚠️ IMPORTANT: When using filters with select parameter:\n' +
				'- ALWAYS include filtered fields in select array\n' +
				'- Creatio OData may fail if field is in filter but not in select\n\n' +
				'Examples:\n' +
				"- By GUID: { all:[{ field:'AccountId', op:'eq', value:'60733efc-f36b-1410-a883-16d83cab0980' }] }\n" +
				"- By lookup name: { all:[{ field:'Type/Name', op:'eq', value:'Employee' }] } (RECOMMENDED!)\n" +
				"- Multiple AND: { all:[{ field:'IsActive', op:'eq', value:true }, { field:'Name', op:'contains', value:'John' }] }\n" +
				"- Multiple OR: { any:[{ field:'StatusId', op:'eq', value:'guid1' }, { field:'StatusId', op:'eq', value:'guid2' }] }\n\n" +
				'💡 If filtering by AccountId, ContactId, etc - include that field in select!',
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
		.positive()
		.max(1000)
		.optional()
		.describe('Max rows to return (suggest 25\u2013200 for responsiveness).'),
} as const;
export const readInput = z.object(readInputShape);

export const readDescriptor = makeToolDescriptor({
	title: 'Read records in Creatio',
	description:
		'Query Creatio records. Workflow: 1) list-entities 2) describe-entity 3) read with select, optional expand, filters/orderBy/top. ' +
		'Key params: select (fields to return), filters or filter (conditions), expand (related entities), orderBy (sorting), top (limit). ' +
		'Always include fields used in filters in select when select is provided. Use structured filters over raw $filter when possible. ' +
		"Use expand to load related entities in one request (e.g. expand:['Account']). " +
		'For date/time filtering see /datetime-guide prompt. For Contact/Owner filtering see /contactid-guide prompt. ' +
		"Example: entity:'Order', select:['Id','Number','Amount','AccountId'], filters:{ all:[{ field:'AccountId', op:'eq', value:'<guid>' }] }, expand:['Account'], orderBy:'Amount desc', top:10",
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
		'Inspect schema for the given entity set: entity type, primary key(s), and properties with types/nullable. Use this before CRUD to avoid invalid fields.',
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

const createSysSettingInputShape = {
	definition: z.object({
		code: z
			.string()
			.min(1)
			.describe(
				'Unique system setting code (e.g., "TestSetting"). Must match Creatio naming rules.',
			),
		name: z
			.string()
			.min(1)
			.describe('Display name for the system setting (e.g., "Test setting").'),
		valueTypeName: z
			.string()
			.min(1)
			.describe(
				'Creatio data value type name (use the "value" string). Supported values: Binary, Boolean, DateTime, Date, Time, Integer, Money, Float, Lookup, ShortText, MediumText, LongText, Text, MaxSizeText, SecureText.',
			),
		description: z.string().optional(),
		isCacheable: z.boolean().optional(),
		referenceSchemaUId: z
			.string()
			.optional()
			.describe(
				'Only required for Lookup settings: set to the EntitySchema UId that the lookup should reference. Retrieve it via VwWorkspaceObjects (e.g., read { entity: "VwWorkspaceObjects", filters: { all: [{ field: "Name", op: "eq", value: "Account" }] }, select: ["UId", "Name"] }).',
			),
		dataValueType: z.union([z.string(), z.number()]).optional(),
		id: z
			.string()
			.uuid()
			.optional()
			.describe('Optional GUID for the sys setting record. Auto-generated when omitted.'),
	}),
	initialValue: z
		.any()
		.optional()
		.describe('Optional initial value to write immediately after creating the system setting.'),
} as const;

export const createSysSettingInput = z.object(createSysSettingInputShape);

export const createSysSettingDescriptor = makeToolDescriptor({
	title: 'Create a new system setting in Creatio',
	description:
		'Creates a brand-new system setting (metadata record) using InsertSysSettingRequest and optionally assigns an initial value via PostSysSettingsValues. Use this when the desired sys setting does not yet exist.\n\n' +
		'SUPPORTED valueTypeName VALUES (use the "value" string):\n' +
		'- Binary → BLOB\n' +
		'- Boolean → Boolean\n' +
		'- DateTime → Date/Time\n' +
		'- Date → Date\n' +
		'- Time → Time\n' +
		'- Integer → Integer\n' +
		'- Money → Currency (0.01)\n' +
		'- Float → Decimal\n' +
		'- Lookup → Lookup\n' +
		'- ShortText → Text (50 chars)\n' +
		'- MediumText → Text (250 chars)\n' +
		'- LongText → Text (500 chars)\n' +
		'- Text → Text\n' +
		'- MaxSizeText → Unlimited text\n' +
		'- SecureText → Encrypted string\n\n' +
		'LOOKUP REFERENCE:\n' +
		'- When valueTypeName = "Lookup", set definition.referenceSchemaUId to the EntitySchema UId of the target object.\n' +
		'- Fetch it via VwWorkspaceObjects (e.g., read { entity: "VwWorkspaceObjects", filters: { all: [{ field: "Name", op: "eq", value: "Account" }] }, select: ["UId", "Name", "Caption"] }).',
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
