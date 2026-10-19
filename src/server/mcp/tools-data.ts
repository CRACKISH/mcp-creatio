import { z } from 'zod';

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// MCP tool annotations: hints a client uses to decide what it may run without asking the user.
// Every tool acts only on the configured Creatio instance, so none is open-world.

/** Reads only. */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
/** Adds data; never removes or overwrites existing data. */
const ADDS: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
/** Overwrites or removes data; repeating the same call has no further effect. */
const CHANGES: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
};
/** Runs server-side logic with effects this server cannot bound (also every proxied published tool). */
export const RUNS: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};
/** Clears a cache: no data changes, safe to repeat. */
const REFRESHES: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

function makeToolDescriptor(opts: {
	title: string;
	description: string;
	inputShape: Record<string, z.ZodTypeAny>;
	annotations: ToolAnnotations;
}) {
	return {
		title: opts.title,
		description: opts.description,
		inputSchema: opts.inputShape,
		annotations: opts.annotations,
	};
}

const CREATIO_GUID_REGEX =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const creatioGuid = () => z.string().regex(CREATIO_GUID_REGEX, 'Must be a 36-character hex GUID');

const entityName = (examples: string) =>
	z.string().min(1).describe(`Entity (object schema) name, e.g. ${examples}.`);

const DATES_RULE =
	'Date/time values are UTC ISO 8601 with a Z suffix ("2026-03-01T09:30:00Z") — convert the user\'s local time first (/datetime-guide).';

// --- Current user -----------------------------------------------------------------------------

const getCurrentUserInfoInputShape = {};
export const getCurrentUserInfoInput = z.object(getCurrentUserInfoInputShape);

export const getCurrentUserInfoDescriptor = makeToolDescriptor({
	title: 'Get the current Creatio user',
	description:
		'Returns the Creatio user this server acts as: { success, userInfo: { id, contactId, contactName, email, cultureInfo, timeZoneId, timeZoneOffsetHours, userRoles, ... } }. ' +
		'Call it once before creating records owned by the user — owner/author lookups (OwnerId, AuthorId) take `userInfo.contactId`, not `userInfo.id` — or when a tool needs the user as a user/role (`adminUnitId` = `userInfo.id`). Reuse the result for the rest of the conversation; reads do not need it. ' +
		"`timeZoneOffsetHours` is the user's Creatio time zone, useful when converting times (/datetime-guide). See /contactid-guide.",
	inputShape: getCurrentUserInfoInputShape,
	annotations: READ_ONLY,
});

// --- Read ----------------------------------------------------------------------------------------

const op = z.enum(['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'contains', 'startswith', 'endswith']);

const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const baseCondition = z.object({
	field: z
		.string()
		.min(1)
		.describe(
			'A column (`Name`), a lookup by id (`AccountId` compared with a GUID) or a related column by path (`Account.Name`). The primary key is `Id`.',
		),
});

const compareCondition = baseCondition.extend({
	op: op.describe(
		'eq, ne, gt, ge, lt, le; contains / startswith / endswith for text (case-insensitive).',
	),
	value: value.describe(
		'Value to compare with: text, number, boolean, a GUID for ids, or null with eq / ne for "is empty" / "is not empty". Quoting and escaping are handled for you.',
	),
});

const inCondition = baseCondition.extend({
	in: z
		.array(z.union([z.string(), z.number(), z.boolean()]))
		.min(1)
		.describe('Matches any of these values (one value type per list).'),
});

const condition = z.union([compareCondition, inCondition]);

const filtersShape = z
	.object({
		all: z.array(condition).min(1).optional().describe('Conditions that must ALL hold (AND).'),
		any: z
			.array(condition)
			.min(1)
			.optional()
			.describe(
				'Conditions of which at least ONE must hold (OR); combined with `all` by AND.',
			),
	})
	.describe(
		'Structured filter: { all: [...], any: [...] } of { field, op, value } or { field, in: [...] }. ' +
			'Examples: { all: [{ field: "Account.Name", op: "eq", value: "Acme" }] }; ' +
			'{ all: [{ field: "OwnerId", op: "eq", value: "<contactId>" }, { field: "Amount", op: "gt", value: 1000 }] }; ' +
			'{ any: [{ field: "Stage.Name", op: "eq", value: "Presentation" }, { field: "Stage.Name", op: "eq", value: "Negotiation" }] }.',
	);

const readInputShape = {
	entity: entityName('"Contact", "Account", "Opportunity", "Activity"'),
	filter: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			z.string().min(1).optional(),
		)
		.describe(
			"Raw OData $filter (escape hatch; prefer `filters`). Strings in single quotes (escape ' as ''), GUIDs and dates unquoted, a lookup by its navigation id (`Account/Id eq <guid>`, not `AccountId`). Example: \"contains(Name,'Acme') and Type/Name eq 'Customer'\". AND-combined with `filters`.",
		),
	filters: filtersShape.optional(),
	select: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe('Columns to return. Recommended: keeps the response small.'),
	expand: z
		.preprocess(
			(v) => (Array.isArray(v) && v.length === 0 ? undefined : v),
			z.array(z.string()).optional(),
		)
		.describe(
			'Related records to include, by navigation name (the lookup column without `Id`): ["Account"], ["Account", "Owner"], nested ["Account($expand=PrimaryContact)"].',
		),
	orderBy: z
		.preprocess(
			(v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
			z.string().optional(),
		)
		.describe('Sort order: "CreatedOn desc", "Name asc, Amount desc".'),
	top: z.coerce
		.number()
		.int()
		.min(0)
		.max(1000)
		.optional()
		.describe(
			'Max rows (default 50, max 1000). With `count: true`, `top: 0` returns only the total.',
		),
	skip: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			'Rows to skip, for paging (page 3 of 25 → skip: 50, top: 25). Use a stable orderBy.',
		),
	count: z
		.boolean()
		.optional()
		.describe(
			'Also return the total number of matching rows (ignoring top/skip): the response becomes { total, value }.',
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
	// The backend decides how related data is read: DataService by column path in `select`,
	// OData through `expand` (its `select` takes direct columns only).
	const related = caps.expand
		? '`select` takes the entity\'s own columns (a lookup as its id, `AccountId`); load related records with `expand: ["Account"]`. '
		: '`select` also takes related columns by path (`Account.Name`); a lookup column (`Account`) returns { value, displayValue }. ';
	const rawFilter = caps.rawFilter
		? 'A raw OData `filter` string is also accepted (prefer `filters`). '
		: '';
	return makeToolDescriptor({
		title: 'Read records',
		description:
			'Query records of one entity: filter, pick columns, sort, page, count. ' +
			'Find the entity first if unsure (dataforge-similar-tables, global-search, list-entities) and check its columns with describe-entity. ' +
			related +
			'`filters` take a column, a lookup id (`OwnerId` = a GUID) or a related column (`Account.Name`). ' +
			rawFilter +
			'`top` defaults to 50; page with `skip` + a stable `orderBy`; `count: true` adds the total ({ total, value }), with `top: 0` for the total alone. ' +
			'Response: an array of rows; a missing value is null (text may be ""). ' +
			'An unknown entity or column fails as "unknown_column:Emial (Contact). Did you mean: Email?" — retry with the suggestion. ' +
			'Example: { entity: "Opportunity", select: ["Title", "Amount", "Stage"], filters: { all: [{ field: "OwnerId", op: "eq", value: "<contactId>" }] }, orderBy: "Amount desc", top: 10 }. ' +
			'More patterns: /query-guide. Dates in filters: /datetime-guide.',
		inputShape: buildReadInputShape(caps),
		annotations: READ_ONLY,
	});
}

// --- Create / update / delete -------------------------------------------------------------------

const RECORD_DATA_RULES =
	'Values: text, numbers, booleans; a lookup by its id — `AccountId: "<guid>"` (find ids with read, dataforge-lookup-values or global-search; never guess them). ' +
	DATES_RULE;

const createInputShape = {
	entity: entityName('"Contact", "Account", "Activity"'),
	data: z
		.record(z.string(), z.any())
		.describe(`Column values of the new record. ${RECORD_DATA_RULES}`),
} as const;
export const createInput = z.object(createInputShape);

export const createDescriptor = makeToolDescriptor({
	title: 'Create a record',
	description:
		"Create one record: { entity, data } → the new record's id. Check required columns and types with describe-entity first; send only the columns you set. " +
		'Owner/author lookups (OwnerId, AuthorId, …) of records the user creates for themselves get their contact id — `userInfo.contactId` from get-current-user-info — unless the user names someone else (/contactid-guide). ' +
		'Activities (tasks, meetings, calls): follow /create-activity-guide. Tags: /tagging-guide. ' +
		'An unknown column fails as "unknown_column:X (Entity). Did you mean: …?". ' +
		'Example: { entity: "Account", data: { Name: "Acme Corp", Phone: "+1 234 567", OwnerId: "<contactId>" } }.',
	inputShape: createInputShape,
	annotations: ADDS,
});

const updateInputShape = {
	entity: entityName('"Contact", "Account", "Activity"'),
	id: z.string().min(1).describe('Id of the record to update.'),
	data: z
		.record(z.string(), z.any())
		.describe(`Only the columns to change. ${RECORD_DATA_RULES}`),
} as const;
export const updateInput = z.object(updateInputShape);

export const updateDescriptor = makeToolDescriptor({
	title: 'Update a record',
	description:
		'Change columns of one record by id; columns you leave out keep their values. ' +
		'Resolve lookup ids instead of guessing them (e.g. a new StatusId from ActivityStatus via read); owner/user lookups take a contact id (/contactid-guide). ' +
		'Example: { entity: "Activity", id: "<id>", data: { StartDate: "2026-03-02T12:00:00Z", DueDate: "2026-03-02T12:30:00Z" } }.',
	inputShape: updateInputShape,
	annotations: CHANGES,
});

const deleteInputShape = {
	entity: entityName('"Contact", "Account", "Activity"'),
	id: z.string().min(1).describe('Id of the record to delete.'),
} as const;
export const deleteInput = z.object(deleteInputShape);

export const deleteDescriptor = makeToolDescriptor({
	title: 'Delete a record',
	description:
		'Permanently delete one record by id. Confirm with the user first: say which record (entity, name, id) will be deleted and wait for an explicit yes. ' +
		'Related records may block the delete (Creatio then reports a reference error) or be removed with it, depending on the object.',
	inputShape: deleteInputShape,
	annotations: CHANGES,
});

// --- Schema discovery ----------------------------------------------------------------------------

export const listEntitiesInput = z.object({});

export const listEntitiesDescriptor = makeToolDescriptor({
	title: 'List entities',
	description:
		'All entity (object schema) names available to this server — usually 1000+. ' +
		'To find an entity by meaning prefer dataforge-similar-tables (when available) or global-search; use this list to check an exact name. Then describe-entity.',
	inputShape: {},
	annotations: READ_ONLY,
});

const describeEntityInputShape = {
	entitySet: entityName('"Contact", "Account"'),
} as const;
export const describeEntityInput = z.object(describeEntityInputShape);

export const describeEntityDescriptor = makeToolDescriptor({
	title: 'Describe an entity',
	description:
		'Columns of one entity — names, types, required/nullable and its key — to plan a read or a write without guessing column names. ' +
		'Response: { source, entitySet, ... } where `source` is "dataforge" (richer column details, when DataForge is enabled), "dataservice" or "odata" (the active backend\'s schema). ' +
		'An unknown entity fails as "unknown_entity:X. Did you mean: …?".',
	inputShape: describeEntityInputShape,
	annotations: READ_ONLY,
});

// --- Business processes ----------------------------------------------------------------------------

const executeProcessInputShape = {
	processName: z
		.string()
		.min(1)
		.describe(
			'Schema name of the process (e.g. "UsrLeadQualification"), not its caption. To find it from a caption, read VwProcessLib: select ["Name", "Caption"], filters { all: [{ field: "Caption", op: "contains", value: "<caption>" }] }, and use `Name`.',
		),
	parameters: z
		.record(z.string(), z.any())
		.optional()
		.describe(
			`Process parameters by their codes, e.g. { "ContactId": "<guid>", "Amount": 1000, "SendNotification": true }. ${DATES_RULE}`,
		),
} as const;
export const executeProcessInput = z.object(executeProcessInputShape);

export const executeProcessDescriptor = makeToolDescriptor({
	title: 'Run a business process',
	description:
		'Start a Creatio business process by its schema name, with optional parameters, and return its result. ' +
		'A process can change any data it is designed to — make sure the user wants it run. ' +
		'User/contact parameters take a contact id (/contactid-guide).',
	inputShape: executeProcessInputShape,
	annotations: RUNS,
});

// --- System settings -----------------------------------------------------------------------------

const querySysSettingsInputShape = {
	sysSettingCodes: z
		.array(z.string().min(1))
		.min(1)
		.describe('Setting codes to read, e.g. ["SiteUrl", "EmailDefSendName"].'),
} as const;

export const querySysSettingsInput = z.object(querySysSettingsInputShape);

export const querySysSettingsDescriptor = makeToolDescriptor({
	title: 'Read system settings',
	description:
		"Current values and metadata of system settings by code. Response: the platform's answer — a success flag, a values map by code (each with its `value`) and `notFoundSettings` for unknown codes. See /sys-settings-guide.",
	inputShape: querySysSettingsInputShape,
	annotations: READ_ONLY,
});

const SYS_SETTING_VALUE_TYPE_DESC =
	'Value type name (Text, Boolean, Integer, Lookup, DateTime, …) — the full list is in /sys-settings-guide.';

const SYS_SETTING_REFERENCE_SCHEMA_DESC =
	'Entity schema UId the lookup points to; required only when valueTypeName is "Lookup" (how to find it: /sys-settings-guide).';

const sysSettingDefinitionFieldShape = {
	code: z.string().min(1).describe('Unique setting code (e.g. "UsrMaxRetries").'),
	name: z.string().min(1).describe('Name shown in the Creatio UI.'),
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
	id: creatioGuid().optional().describe('Id for the new setting; generated when omitted.'),
});

const updateSysSettingDefinitionSchema = sysSettingDefinitionSchema.partial().extend({
	code: sysSettingDefinitionFieldShape.code,
	name: sysSettingDefinitionFieldShape.name,
	valueTypeName: sysSettingDefinitionFieldShape.valueTypeName,
});

const createSysSettingInputShape = {
	definition: createSysSettingDefinitionSchema,
	initialValue: z.any().optional().describe('Value to set right after creating the setting.'),
} as const;

export const createSysSettingInput = z.object(createSysSettingInputShape);

export const createSysSettingDescriptor = makeToolDescriptor({
	title: 'Create a system setting',
	description:
		'Create a new system setting (its definition) and optionally set its first value. Value types and lookup settings: /sys-settings-guide.',
	inputShape: createSysSettingInputShape,
	annotations: ADDS,
});

const setSysSettingsValueInputShape = {
	sysSettingsValues: z
		.record(z.string(), z.any())
		.describe(
			'New values by setting code, e.g. { "UsrMaxRetries": 5, "UsrFeatureOn": true, "UsrSenderName": "Support" }.',
		),
} as const;

export const setSysSettingsValueInput = z.object(setSysSettingsValueInputShape);

export const setSysSettingsValueDescriptor = makeToolDescriptor({
	title: 'Set system setting values',
	description:
		"Set the values of one or more existing system settings in one request; returns the platform's answer. System settings can change how the whole instance behaves — confirm the change with the user.",
	inputShape: setSysSettingsValueInputShape,
	annotations: CHANGES,
});

const updateSysSettingDefinitionInputShape = {
	id: creatioGuid().describe('Id of the setting to change.'),
	definition: updateSysSettingDefinitionSchema.describe(
		'Changed metadata. Creatio requires `code`, `name` and `valueTypeName` on every update — send the current values for those you do not change.',
	),
} as const;

export const updateSysSettingDefinitionInput = z.object(updateSysSettingDefinitionInputShape);

export const updateSysSettingDefinitionDescriptor = makeToolDescriptor({
	title: 'Change a system setting definition',
	description:
		"Change a setting's metadata (name, description, value type, cache / personal flags, lookup schema) — not its value (use set-sys-settings-value). See /sys-settings-guide.",
	inputShape: updateSysSettingDefinitionInputShape,
	annotations: CHANGES,
});

// --- Feature toggles -------------------------------------------------------------------------------

const refreshFeatureCacheInputShape = {
	featureCode: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Feature code to refresh (e.g. "FreedomUIComposableApp"); omit to refresh all features.',
		),
} as const;

export const refreshFeatureCacheInput = z.object(refreshFeatureCacheInputShape);

export const refreshFeatureCacheDescriptor = makeToolDescriptor({
	title: 'Refresh the feature-toggle cache',
	description:
		'Make Creatio re-read feature-toggle states for all users. set-feature-state already does this; use it after changing `Feature` / `AdminUnitFeatureState` rows with create / update / delete. See /feature-toggle-guide.',
	inputShape: refreshFeatureCacheInputShape,
	annotations: REFRESHES,
});

const featureCode = () =>
	z.string().min(1).describe('Feature code, exact match (e.g. "FreedomUIComposableApp").');

const listFeaturesInputShape = {
	search: z
		.string()
		.min(1)
		.optional()
		.describe('Part of the feature code, case-insensitive (e.g. "Freedom").'),
	source: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Only features from this source: "DbFeatureProvider" (a DB row), "web.config", "Metadata", "GlobalAppSettings".',
		),
	enabledForCurrentUser: z
		.boolean()
		.optional()
		.describe(
			'Only features that are on (true) or off (false) for the user this server acts as.',
		),
	top: z.coerce
		.number()
		.int()
		.min(1)
		.max(500)
		.default(50)
		.describe('Max features (default 50); instances define 1000+.'),
	skip: z.coerce.number().int().min(0).optional().describe('Features to skip, for paging.'),
} as const;

export const listFeaturesInput = z.object(listFeaturesInputShape);

export const listFeaturesDescriptor = makeToolDescriptor({
	title: 'List feature toggles',
	description:
		'Feature toggles from every source — DB rows and also web.config, package metadata and GlobalAppSettings features — ordered by code. ' +
		'Each: { code, name, description?, source, enabledByDefault, enabledForCurrentUser }. Response: { items, hasMore } — page with `skip` while hasMore is true. ' +
		'Per-user/role overrides of one feature: get-feature. See /feature-toggle-guide.',
	inputShape: listFeaturesInputShape,
	annotations: READ_ONLY,
});

const getFeatureInputShape = { code: featureCode() } as const;

export const getFeatureInput = z.object(getFeatureInputShape);

export const getFeatureDescriptor = makeToolDescriptor({
	title: 'Get a feature toggle',
	description:
		'One feature (fields as in list-features) plus `overrides`: [{ adminUnitId, adminUnitName, enabled }] — the users/roles whose state differs from the default. Unknown code: feature_not_found:<code>.',
	inputShape: getFeatureInputShape,
	annotations: READ_ONLY,
});

const setFeatureStateInputShape = {
	code: featureCode(),
	state: z
		.enum(['enabled', 'disabled', 'inherit'])
		.describe(
			'"enabled" / "disabled"; "inherit" removes the override of `adminUnitId` so the default applies again (needs adminUnitId).',
		),
	adminUnitId: creatioGuid()
		.optional()
		.describe(
			'User or role to override for — a SysAdminUnit id (the current user: `userInfo.id` from get-current-user-info; others: read SysAdminUnit by Name). Omit to change the default for everyone without an override.',
		),
} as const;

export const setFeatureStateInput = z.object(setFeatureStateInputShape);

export const setFeatureStateDescriptor = makeToolDescriptor({
	title: 'Turn a feature toggle on or off',
	description:
		"Change a feature's default state, or override it for one user/role, for features from any source. The first change to a web.config / metadata feature gives it a DB row, which then takes precedence over that source (the Creatio feature page behaves the same). " +
		'Returns the feature as in get-feature plus `cacheCleared`. "feature_state_not_applied:<code>" means Creatio did not save it. `cacheCleared: false` means it IS saved but the instance could not refresh its cache (seen on .NET 8), so it may take effect later — tell the user. See /feature-toggle-guide.',
	inputShape: setFeatureStateInputShape,
	annotations: CHANGES,
});

// --- Links and attachments --------------------------------------------------------------------------

const getRecordUrlInputShape = {
	entity: entityName('"Contact", "Opportunity"'),
	id: creatioGuid().describe('Record id.'),
} as const;

export const getRecordUrlInput = z.object(getRecordUrlInputShape);

export const getRecordUrlDescriptor = makeToolDescriptor({
	title: 'Get a link to a record',
	description:
		'{ url } that opens the record in Creatio; Creatio picks the right page (classic or Freedom UI). Give it to the user whenever you refer to a specific record. ' +
		'A signed-out visitor goes through login first; an object without a record page opens the home page. Built locally — no request to Creatio.',
	inputShape: getRecordUrlInputShape,
	annotations: READ_ONLY,
});

const listRecordFilesInputShape = {
	entity: entityName('"Account", "Opportunity", "Case"'),
	id: creatioGuid().describe('Record id.'),
	top: z.coerce
		.number()
		.int()
		.min(1)
		.max(200)
		.default(50)
		.describe('Max attachments (default 50), newest first.'),
} as const;

export const listRecordFilesInput = z.object(listRecordFilesInputShape);

export const listRecordFilesDescriptor = makeToolDescriptor({
	title: "List a record's attachments",
	description:
		"Files and links attached to one record, from both places Creatio keeps them (the object's <Entity>File table and SysFile), newest first. " +
		'Response: { files: [{ id, name, kind: "file" | "link" | "object-link", size, createdOn, storage, downloadUrl? (files), url? (links) }], hasMore }. ' +
		"Metadata only — the content is never read. `downloadUrl` works in the user's signed-in Creatio browser session: give it to the user, you cannot fetch it.",
	inputShape: listRecordFilesInputShape,
	annotations: READ_ONLY,
});

// --- System operations -------------------------------------------------------------------------------

const upsertAdminOperationInputShape = {
	id: creatioGuid()
		.optional()
		.describe('Id of the operation to update; omit to create a new one (its id is returned).'),
	name: z.string().min(1).describe('Name, e.g. "Can manage administration".'),
	code: z
		.string()
		.min(1)
		.describe('Unique code, PascalCase without spaces, e.g. "CanManageAdministration".'),
	description: z.string().optional().describe('What the operation allows.'),
} as const;

export const upsertAdminOperationInput = z.object(upsertAdminOperationInputShape);

export const upsertAdminOperationDescriptor = makeToolDescriptor({
	title: 'Create or update a system operation',
	description:
		'Create a system operation (SysAdminOperation) — omit `id` — or update one by `id`. The platform blocks the generic create/update tools for this table; reading it works with read. Returns the operation id. See /admin-operation-guide.',
	inputShape: upsertAdminOperationInputShape,
	annotations: CHANGES,
});

const deleteAdminOperationInputShape = {
	ids: z
		.array(creatioGuid())
		.min(1)
		.describe('Ids of the operations (find them with read on SysAdminOperation by Code).'),
} as const;

export const deleteAdminOperationInput = z.object(deleteAdminOperationInputShape);

export const deleteAdminOperationDescriptor = makeToolDescriptor({
	title: 'Delete system operations',
	description:
		'Delete system operations by id, together with their grants. The generic delete tool is blocked for this table. Confirm with the user first. See /admin-operation-guide.',
	inputShape: deleteAdminOperationInputShape,
	annotations: CHANGES,
});

const setAdminOperationGranteeInputShape = {
	adminOperationId: creatioGuid().describe(
		'Id of the system operation (read SysAdminOperation by Code).',
	),
	adminUnitIds: z
		.array(creatioGuid())
		.min(1)
		.describe(
			'Users or roles to grant/deny — SysAdminUnit ids (read SysAdminUnit by Name), not contact ids.',
		),
	canExecute: z.boolean().describe('true grants (allow), false denies.'),
} as const;

export const setAdminOperationGranteeInput = z.object(setAdminOperationGranteeInputShape);

export const setAdminOperationGranteeDescriptor = makeToolDescriptor({
	title: 'Grant or deny a system operation',
	description:
		'Allow or deny a system operation for users/roles. Repeating it for the same operation and user/role updates the existing grant instead of adding another. See /admin-operation-guide.',
	inputShape: setAdminOperationGranteeInputShape,
	annotations: CHANGES,
});

const deleteAdminOperationGranteeInputShape = {
	ids: z
		.array(creatioGuid())
		.min(1)
		.describe(
			'Ids of SysAdminOperationGrantee rows (read them by SysAdminOperationId and/or SysAdminUnitId).',
		),
} as const;

export const deleteAdminOperationGranteeInput = z.object(deleteAdminOperationGranteeInputShape);

export const deleteAdminOperationGranteeDescriptor = makeToolDescriptor({
	title: 'Remove system operation grants',
	description:
		'Delete grant rows by id, so the operation is neither allowed nor denied explicitly for those users/roles. To switch allow ↔ deny use set-admin-operation-grantee.',
	inputShape: deleteAdminOperationGranteeInputShape,
	annotations: CHANGES,
});

// --- Generic configuration service ----------------------------------------------------------------

const SERVICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const callConfigurationServiceInputShape = {
	service: z
		.string()
		.regex(SERVICE_NAME_PATTERN, 'Service name must match ^[A-Za-z][A-Za-z0-9_-]*$')
		.describe('Service name, e.g. "RightsService" (called at /0/rest/<service>/<method>).'),
	method: z
		.string()
		.regex(SERVICE_NAME_PATTERN, 'Method name must match ^[A-Za-z][A-Za-z0-9_-]*$')
		.describe('Method name, e.g. "GetCanExecuteOperation".'),
	httpMethod: z
		.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
		.default('POST')
		.describe('HTTP method; most Creatio configuration services use POST.'),
	body: z
		.record(z.string(), z.any())
		.optional()
		.describe(
			'JSON body for POST/PATCH/PUT: the method\'s parameters as top-level keys, e.g. { "operation": "CanManageAdministration" }.',
		),
	query: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional()
		.describe('Query-string parameters.'),
} as const;

export const callConfigurationServiceInput = z.object(callConfigurationServiceInputShape);

export const callConfigurationServiceDescriptor = makeToolDescriptor({
	title: 'Call a configuration service',
	description:
		'Escape hatch: call any configuration-package REST method (/0/rest/<service>/<method>) when no dedicated tool covers the task — those validate input and explain their effects, so prefer them. The method may change data. Response: { status, contentType, body } (JSON parsed).',
	inputShape: callConfigurationServiceInputShape,
	annotations: RUNS,
});

// ---------------------------------------------------------------------------
// DataForge — AI-oriented semantic discovery over the Creatio data model (registered only when
// DataForge is enabled). These call POST /0/rest/DataForgeSchemaReadService/<method>, which forwards
// to the DataForge service. They complement describe-entity (the exact schema, always available):
// DataForge finds the right table / relation / lookup value by meaning.
// Typical chain: dataforge-similar-tables → describe-entity → read / create.
// ---------------------------------------------------------------------------

const DATAFORGE_RESPONSE_NOTE =
	' Response: { status, contentType, body }; if DataForge is not ready, body.Success is false with ErrorInfo — check dataforge-status.';

const dataforgeSimilarTablesInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'What data you are looking for, in any language (e.g. "customer support tickets", "продажі по угодах").',
		),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(200)
		.optional()
		.describe('Max candidate tables (server default about 50).'),
} as const;
export const dataforgeSimilarTablesInput = z.object(dataforgeSimilarTablesInputShape);

export const dataforgeSimilarTablesDescriptor = makeToolDescriptor({
	title: 'Find tables by meaning (DataForge)',
	description:
		'Map a concept to the entities (tables) that hold it, by meaning rather than exact name. Use it first when you do not know which entity the user means, then describe-entity on the pick.' +
		DATAFORGE_RESPONSE_NOTE,
	inputShape: dataforgeSimilarTablesInputShape,
	annotations: READ_ONLY,
});

const dataforgeTableDetailsInputShape = {
	query: z.string().min(1).describe('What data you are looking for.'),
	limit: z.coerce.number().int().positive().max(200).optional().describe('Max tables to return.'),
} as const;
export const dataforgeTableDetailsInput = z.object(dataforgeTableDetailsInputShape);

export const dataforgeTableDetailsDescriptor = makeToolDescriptor({
	title: 'Find tables with details (DataForge)',
	description:
		"Like dataforge-similar-tables, plus each match's description and columns as DataForge knows them. Confirm the exact columns with describe-entity before a write." +
		DATAFORGE_RESPONSE_NOTE,
	inputShape: dataforgeTableDetailsInputShape,
	annotations: READ_ONLY,
});

const dataforgeTableRelationshipsInputShape = {
	sourceTable: z.string().min(1).describe('Entity to start from, e.g. "Contact".'),
	targetTable: z.string().min(1).describe('Entity to reach, e.g. "Account".'),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(50)
		.optional()
		.describe('Max relationship paths (server default about 5).'),
	bidirectional: z.boolean().optional().describe('Search both directions (server default true).'),
	skipDetails: z.boolean().optional().describe('Return only the paths, without column details.'),
} as const;
export const dataforgeTableRelationshipsInput = z.object(dataforgeTableRelationshipsInputShape);

export const dataforgeTableRelationshipsDescriptor = makeToolDescriptor({
	title: 'How two tables are related (DataForge)',
	description:
		'The column path(s) connecting two entities — use it to build a related-column path for read (e.g. `Account.Name`) or to understand the data model.' +
		DATAFORGE_RESPONSE_NOTE,
	inputShape: dataforgeTableRelationshipsInputShape,
	annotations: READ_ONLY,
});

const dataforgeLookupValuesInputShape = {
	query: z
		.string()
		.min(1)
		.describe('The value as the user says it (e.g. "in progress", "VIP", "закрита угода").'),
	schemaName: z
		.string()
		.min(1)
		.optional()
		.describe('Lookup to search in, e.g. "CaseStatus"; omit to search all lookups.'),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Max values (server default about 5).'),
} as const;
export const dataforgeLookupValuesInput = z.object(dataforgeLookupValuesInputShape);

export const dataforgeLookupValuesDescriptor = makeToolDescriptor({
	title: 'Find lookup values by meaning (DataForge)',
	description:
		'Resolve a phrase to lookup records and their ids — e.g. "high priority" to the ActivityPriority id for a filter or a write.' +
		DATAFORGE_RESPONSE_NOTE,
	inputShape: dataforgeLookupValuesInputShape,
	annotations: READ_ONLY,
});

export const dataforgeStatusInput = z.object({});

export const dataforgeStatusDescriptor = makeToolDescriptor({
	title: 'DataForge status',
	description:
		'Whether DataForge is online and its data is synced: { IsOnline, Liveness, Readiness, DataStructureReadiness, LookupsReadinessInfo }. ' +
		'IsOnline false: the other dataforge-* tools will fail. Readiness 200 with non-empty DataStructureReadiness / LookupsReadinessInfo: searches return results.',
	inputShape: {},
	annotations: READ_ONLY,
});

// ---------------------------------------------------------------------------
// Global Search — Creatio's cross-entity record search (the UI search box), registered only when
// Global Search is enabled on the environment (non-empty `GlobalSearchUrl`).
// ---------------------------------------------------------------------------

const globalSearchInputShape = {
	query: z
		.string()
		.min(1)
		.describe(
			'Words to search for, like in the Creatio search box (e.g. "andrew baker", "acme invoice 2024").',
		),
	entities: z
		.array(z.string().min(1))
		.optional()
		.describe(
			'Entities to search in, e.g. ["Contact", "Account"]; omit to search all indexed sections.',
		),
	limit: z.coerce
		.number()
		.int()
		.positive()
		.max(100)
		.optional()
		.describe('Max records (server default about 15).'),
	from: z.coerce
		.number()
		.int()
		.min(0)
		.optional()
		.describe("Results to skip, for paging — pass the previous response's `nextFrom`."),
} as const;
export const globalSearchInput = z.object(globalSearchInputShape);

export const globalSearchDescriptor = makeToolDescriptor({
	title: 'Search records across entities',
	description:
		'Full-text search over all indexed records, the way the Creatio search box works: find a record by name, number or keyword without knowing its entity ("find Andrew Baker", "the Acme renewal"). ' +
		'Response: records with { entityName, id, columnValues, foundColumns }, plus total / nextFrom for paging. ' +
		'For exact conditions on one entity use read.',
	inputShape: globalSearchInputShape,
	annotations: READ_ONLY,
});
