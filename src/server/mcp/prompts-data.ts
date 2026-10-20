/**
 * Guides for multi-step Creatio work. Each is served two ways: as an MCP prompt the user can invoke
 * (`/query-guide`) and through the `get-guide` tool, which the model can call itself — most clients
 * do not let the model open prompts, so tool descriptions point to `get-guide`.
 *
 * Every fact here is verified against a live Creatio (.NET Framework and .NET 8, both CRUD backends).
 */

// Base-package ids, the same on every Creatio instance (CrtBase seed data / ActivityConsts; verified on
// 10.2 .NET Framework and .NET 8). Names can be renamed per instance, so the guide goes by id.
const ACTIVITY_IDS = {
	TYPE_TASK: 'fbe0acdc-cfc0-df11-b00f-001d60e938c6',
	TYPE_CALL: 'e1831dec-cfc0-df11-b00f-001d60e938c6',
	CATEGORY_TODO: 'f51c4643-58e6-df11-971b-001d60e938c6',
	CATEGORY_MEETING: '42c74c49-58e6-df11-971b-001d60e938c6',
	CATEGORY_CALL_TASK: '03df85bf-6b19-4dea-8463-d5d49b80bb28',
	CATEGORY_PAPERWORK: '2365ae4f-58e6-df11-971b-001d60e938c6',
	CATEGORY_CALL_CALL: 'e52bd583-7825-e011-8165-00155d043204',
	STATUS_NOT_STARTED: '384d4b84-58e6-df11-971b-001d60e938c6',
	STATUS_IN_PROGRESS: '394d4b84-58e6-df11-971b-001d60e938c6',
	STATUS_COMPLETED: '4bdbb88f-58e6-df11-971b-001d60e938c6',
	STATUS_CANCELED: '201cfba8-58e6-df11-971b-001d60e938c6',
	PRIORITY_HIGH: 'd625a9fc-7ee6-df11-971b-001d60e938c6',
	PRIORITY_MEDIUM: 'ab96fa02-7fe6-df11-971b-001d60e938c6',
	PRIORITY_LOW: 'ac96fa02-7fe6-df11-971b-001d60e938c6',
} as const;

const QUERY_GUIDE = `
# Querying Creatio data

## 1. Find the entity
- You know the name (\`Contact\`, \`Opportunity\`) → go to step 2.
- You know the meaning ("support tickets", "invoices") → \`dataforge-similar-tables\` when available; otherwise check names with \`list-entities\` (1000+ names, so search it for a word).
- You are looking for one specific record by name or number ("Andrew Baker", "INV-1024") → \`global-search\` when available: it finds it in any entity and tells you which.

## 2. Check the columns
\`describe-entity\` lists the columns, their types and which are required. Use the exact names it returns. A wrong name is rejected with a suggestion — \`unknown_column:Emial (Contact). Did you mean: Email?\` — so retry with the suggestion instead of guessing.

## 3. Read
Ask for what you need, no more: \`select\` the columns you will use and keep \`top\` small (default 50).

| Need | How |
|------|-----|
| A column of a related record | \`select: ["Name", "Account.Name"]\` — or, if \`read\` has an \`expand\` parameter (OData backend), \`select: ["AccountId"], expand: ["Account"]\` |
| Filter by a related record's id | \`{ field: "AccountId", op: "eq", value: "<guid>" }\` |
| Filter by a related record's name | \`{ field: "Account.Name", op: "eq", value: "Acme" }\` |
| A record by its name | \`{ field: "Name", op: "eq", value: "Acme Corp" }\` first; nothing found → \`contains\`; several found → ask the user which one |
| Text search in a column | \`{ field: "Name", op: "contains", value: "acme" }\` (case-insensitive) |
| One of several values | \`{ field: "Stage.Name", in: ["Presentation", "Negotiation"] }\` |
| Empty / not empty | \`{ field: "Email", op: "eq", value: null }\` / \`op: "ne"\` |
| A date range | \`{ field: "CreatedOn", op: "ge", value: "2026-01-01" }\` + \`op: "lt"\` for the end (in the user's time zone — datetime-guide) |
| AND / OR | \`filters: { all: [...], any: [...] }\` — \`all\` is AND, \`any\` is OR, and the two groups are combined by AND |
| Newest / biggest first | \`orderBy: "CreatedOn desc"\`, \`orderBy: "Amount desc, Title asc"\` |
| "How many …?" | \`count: true, top: 0\` → \`{ total, value: [] }\` — never page through rows to count them |
| The next page | same query with \`skip\` += \`top\` and a stable \`orderBy\` |

What comes back:
- A missing value is \`null\` (a text column may also be \`""\`).
- A lookup column you select by itself (\`Account\`, \`ModifiedBy\`) is \`{ value, displayValue }\`. If \`read\` has an \`expand\` parameter (OData backend), select its id (\`AccountId\`) and \`expand\` the record for its name instead.
- A date/time is in the user's Creatio time zone with its offset (\`"2026-11-10T14:00:00+02:00"\`); a Date column is \`"YYYY-MM-DD"\`.
- Ids are GUIDs. Never invent one: resolve a lookup value by reading its table (\`ActivityPriority\` by \`Name\`) or with \`dataforge-lookup-values\`.

Periods, from \`userInfo.today\` (get-current-user-info), each as \`ge\` the first day and \`lt\` the day after the last, and say which dates you used:
- this week: Monday to Sunday around today; this month / quarter / year: the calendar one around today;
- last week / month / quarter / year: the calendar one before; "recent" / "lately": ask, or take the last 30 days and say so.
- "we" / "our": everything the user can see — no owner filter; "my": \`OwnerId\` = the user's contact id.

Activities (tasks, meetings, calendar, overdue): create-activity-guide, section 6, has the ready queries.

## 4. Present the results
- Mentioning a specific record? Add its link: \`get-record-url { entity, id }\`.
- The user asks about a record's documents? \`list-record-files { entity, id }\` lists its files and links; hand the user the \`downloadUrl\`.
- Prefer names over ids in your answer; keep ids for follow-up calls.
- Times: show them as read (the user's Creatio time zone) and say so when it may matter.

## 5. People: user id vs contact id
Owner / author / responsible columns point to a **Contact**: use \`userInfo.contactId\` from \`get-current-user-info\` for the current user. Tools that take a user or role (\`set-feature-state\`, \`set-admin-operation-grantee\`) want a **SysAdminUnit** id: \`userInfo.id\`. See contactid-guide.
`.trim();

const CREATE_ACTIVITY_GUIDE = `
# Creating activities (tasks, meetings, calls)

An activity has a **type** and a **category**, and they are easy to mix up:
- The **type** (\`TypeId\`) is the kind of record. Everything a user plans — a task, a meeting, a call — is type **Task**; that is what Creatio's own pages, the calendar and the task list create and show.
- The **category** (\`ActivityCategoryId\`) says what the task is about. Each category belongs to exactly one type, and the same name can exist under two types ("Call" is both a Task category and a Call-type category).
- Send **both**, and a matching pair. Creatio does not check the pair, and it fills an omitted type with Task — so sending only a category of another type saves a broken activity.

## 1. Pick type, category and calendar flag

| The user asks for | TypeId | ActivityCategoryId | ShowInScheduler |
|---|---|---|---|
| a meeting, appointment, sync | Task \`${ACTIVITY_IDS.TYPE_TASK}\` | Meeting \`${ACTIVITY_IDS.CATEGORY_MEETING}\` | true |
| a task, to-do, "remind me to …", "send an email to …" | Task | To do \`${ACTIVITY_IDS.CATEGORY_TODO}\` | false |
| a call to make ("call Acme at 10") | Task | Call \`${ACTIVITY_IDS.CATEGORY_CALL_TASK}\` | true when it has a time of day, false for "call Acme sometime this week" |
| paperwork | Task | Paper work \`${ACTIVITY_IDS.CATEGORY_PAPERWORK}\` | false |

\`ShowInScheduler: true\` puts the activity in the calendar; Creatio sets it for meetings and clears it for the other categories, but only in its own pages — set it yourself.

These ids are the same on every Creatio. Do not create other types by hand:
- **Email** activities are real emails from the mail integration; creating one may queue an email. For "email Bob" create a To do task.
- **Call** type (\`${ACTIVITY_IDS.TYPE_CALL}\` with its own Call category \`${ACTIVITY_IDS.CATEGORY_CALL_CALL}\`) is for telephony records and does not show in the calendar or task list — use it only when the user explicitly asks for that type.
- **Visit** exists only in field-sales products.
If the user names a category this table lacks (a custom one), read it with its type: \`read\` ActivityCategory — \`select: ["Id", "Name", "ActivityTypeId"], filters: { all: [{ field: "Name", op: "contains", value: "<name>" }] }\` — and send that \`ActivityTypeId\` as \`TypeId\`.

## 2. Owner, status, priority
Required: \`Title\`, \`StartDate\`, \`DueDate\`, the category (with its type), status and priority — Creatio fills status Not started and priority Medium when you leave them out; send them to set another value.
- \`OwnerId\` and \`AuthorId\`: \`userInfo.contactId\` from \`get-current-user-info\` (once per conversation) — the contact id, not \`userInfo.id\` — unless the user names someone else (contactid-guide).
- Status: Not started \`${ACTIVITY_IDS.STATUS_NOT_STARTED}\`, In progress \`${ACTIVITY_IDS.STATUS_IN_PROGRESS}\`, Completed \`${ACTIVITY_IDS.STATUS_COMPLETED}\`, Canceled \`${ACTIVITY_IDS.STATUS_CANCELED}\`.
- Priority: High \`${ACTIVITY_IDS.PRIORITY_HIGH}\`, Medium \`${ACTIVITY_IDS.PRIORITY_MEDIUM}\`, Low \`${ACTIVITY_IDS.PRIORITY_LOW}\`.

## 3. Times
- Send times as the user says them — they are in the user's Creatio time zone (\`"2026-11-10T14:00:00"\`); do not convert to UTC or ask for a zone. "Tomorrow", "Friday": count from \`userInfo.today\`. A time in another zone ("10:00 New York time") goes with its offset (\`"2026-11-11T10:00:00-05:00"\`); read the activity back to quote the user's time (datetime-guide).
- Always send \`StartDate\` and \`DueDate\`: Creatio defaults both to "now". Without a duration use 30 minutes, as the Creatio activity page does.
- A day without a time ("on Friday"): 09:00–09:30 that day, and tell the user you picked 09:00.
- A reminder pops up for the owner in Creatio: \`RemindToOwner: true\` and \`RemindToOwnerDate\` (a time like \`StartDate\`). "Remind me to X on Friday" → a To do for Friday with the reminder at its start; "remind me 15 minutes before" → \`StartDate\` minus 15 minutes.
- Details the user gives ("about the renewal") go into the \`Title\`, longer text into \`Notes\`.

## 4. Create
\`\`\`json
{ "entity": "Activity", "data": {
  "Title": "Meeting with Acme",
  "TypeId": "${ACTIVITY_IDS.TYPE_TASK}",
  "ActivityCategoryId": "${ACTIVITY_IDS.CATEGORY_MEETING}",
  "ShowInScheduler": true,
  "StartDate": "2026-11-10T14:00:00",
  "DueDate": "2026-11-10T15:00:00",
  "StatusId": "${ACTIVITY_IDS.STATUS_NOT_STARTED}",
  "PriorityId": "${ACTIVITY_IDS.PRIORITY_MEDIUM}",
  "OwnerId": "<userInfo.contactId>",
  "AuthorId": "<userInfo.contactId>"
} }
\`\`\`
Connect it to what it is about when the user names it: \`AccountId\`, \`ContactId\`, \`OpportunityId\`, \`LeadId\`, \`CaseId\` (ids from \`read\`; never guess).

## 5. Participants
Creatio adds the owner (and the activity's \`ContactId\`) as participants itself — do not add them. For anyone else: find the contact (\`read\` Contact by \`Name\` with \`contains\`; ask if several match), then
\`{ "entity": "ActivityParticipant", "data": { "ActivityId": "<activity id>", "ParticipantId": "<contact id>" } }\` — one per person.

## 6. Finding and changing activities
- "My tasks" / "my to-dos": \`read\` Activity with \`OwnerId\` = the user's contact id and \`ActivityCategoryId\` = To do (meetings and calls are type Task too — filter by category, or say what the list contains). Open ones: \`Status.Finish\` = false (Finish is true for Completed and Canceled); overdue: also \`DueDate\` < \`userInfo.now\`.
- A meeting on a day: Activity with \`StartDate\` ≥ that day and < the next day, plus \`OwnerId\`, \`ContactId\` or \`Title\` \`contains\`. Meetings the user only takes part in: \`read\` ActivityParticipant with \`ParticipantId\` = their contact id and \`Activity.StartDate\` in the window, \`select: ["ActivityId"]\`. Several matches → ask which one.
- "My calendar this week": Activity with \`ShowInScheduler\` = true, \`OwnerId\` = the user's contact id and \`StartDate\` in the week (Monday to the next Monday, from \`userInfo.today\`), \`orderBy: "StartDate asc"\`; add the meetings they only take part in (participant query above, then \`read\` those ids with \`{ field: "Id", in: [...] }\`). Leave out Canceled (\`${ACTIVITY_IDS.STATUS_CANCELED}\`).
- Reschedule: \`update\` \`StartDate\` and \`DueDate\` together (keep the duration). Participants are not notified — say so if it matters.
- Done / cancelled: \`update\` \`StatusId\` (Completed / Canceled).

## 7. Confirm
Tell the user what you created or changed — title, date and time (in their Creatio time zone), what it is (meeting / task / call), the assumptions you made (time, duration) — with its link (\`get-record-url\`). Creatio sends no invitation or notice to participants for activities created or moved here: say so when other people take part.
`.trim();

const DATETIME_GUIDE = `
# Dates and time zones in Creatio

Every Creatio user has a profile time zone, and Creatio shows and stores dates in it: a meeting at
14:00 is at 14:00 in the user's zone. The record tools (read, create, update, filters) work the same
way, so you do not need to ask the user for a time zone or convert anything yourself.

## Which zone

\`get-current-user-info\` returns it: \`userInfo.timeZone\` (IANA, e.g. "Europe/Kyiv") and
\`userInfo.utcOffset\` (today's offset, e.g. "+03:00"). Daylight saving is applied per date by the
server, so a date in winter may carry a different offset than today.

## Writing (create, update) and filtering

| You send | Meaning |
|---|---|
| \`"2026-11-10T14:00:00"\` (no zone) | 14:00 in the user's Creatio time zone — what the user means by "at 2pm" |
| \`"2026-11-10"\` on a date/time column | the user's midnight that day |
| \`"2026-11-10T14:00:00+02:00"\` or \`"…T12:00:00Z"\` | that exact instant (use it when the user names another zone — with that zone's offset **on that date**: New York is -05:00 in winter, -04:00 in summer) |
| \`"1990-12-07"\` on a Date column (BirthDate, …) | that calendar date — never shifted |
| \`"09:30"\` on a Time column | that clock time — never shifted |

## Reading

- A date/time comes back in the user's zone, labelled with its offset:
  \`"2026-11-10T14:00:00+02:00"\` — show the user "14:00" (and the date).
- A Date column comes back as \`"YYYY-MM-DD"\`, a Time column as \`"HH:mm:ss"\`.
- A missing value is \`null\`.

## Telling the user

Times you show or confirm are in the user's Creatio time zone. Say so when it may differ from where
the user is ("14:00 in your Creatio time zone, Europe/Kyiv"), and when the user names another zone,
confirm both ("09:00 New York = 16:00 your time") — read the record back and quote the time it shows rather than converting yourself.

## Examples

User: "Schedule a meeting tomorrow at 14:00 for an hour" (today is 2026-11-09)
\`\`\`json
{ "entity": "Activity", "data": { "StartDate": "2026-11-10T14:00:00", "DueDate": "2026-11-10T15:00:00" } }
\`\`\`

User: "A call at 9:00 New York time"
\`\`\`json
{ "data": { "StartDate": "2026-11-10T09:00:00-05:00" } }
\`\`\`

User: "Activities created this month" (November 2026)
\`\`\`json
{ "entity": "Activity", "filters": { "all": [
  { "field": "CreatedOn", "op": "ge", "value": "2026-11-01" },
  { "field": "CreatedOn", "op": "lt", "value": "2026-12-01" }
] } }
\`\`\`

## Rules

- Relative dates ("tomorrow", "in 2 hours") are relative to the user's time: take "now" in
  \`userInfo.timeZone\`.
- Use an offset or Z only for an instant in another zone, or one you received with an offset.
- Copying a value you read into a write or a filter keeps its meaning (it carries its offset).
- Durations: DueDate = StartDate + duration, in the same zone.
`.trim();

const CONTACTID_GUIDE = `
# People in Creatio: contact id vs user id

A person who uses Creatio has two records, and each kind of field wants a different one:

| Record | Id | Used by |
|--------|----|---------|
| **Contact** (the person in the CRM) | \`userInfo.contactId\` | Owner, Author, Responsible, Manager, ParticipantId, and the audit columns CreatedBy / ModifiedBy — every CRM lookup to a person |
| **SysAdminUnit** (the login account / role) | \`userInfo.id\` | users and roles in permissions: \`set-feature-state\`, \`set-admin-operation-grantee\` |

Putting a user id into an owner field fails (or points at nobody) — owner/author fields always take the **contact** id.

## The current user
Call \`get-current-user-info\` once and reuse the answer for the conversation:

\`\`\`json
{ "success": true, "userInfo": { "id": "<SysAdminUnit id>", "contactId": "<Contact id>", "contactName": "…", "timeZone": "Europe/Kyiv", "utcOffset": "+02:00", "…": "…" } }
\`\`\`

Records the user creates for themselves (tasks, meetings, leads, opportunities, cases) get their contact id as owner and author. Do not ask "for whom?" — only use someone else when the user says so ("a task for John").

\`\`\`json
{ "entity": "Activity", "data": { "Title": "Call Acme", "OwnerId": "<userInfo.contactId>", "AuthorId": "<userInfo.contactId>" } }
\`\`\`

## Someone else
- Their **contact**: \`read\` Contact — \`select: ["Id", "Name"], filters: { all: [{ field: "Name", op: "contains", value: "John" }] }\`. If several match, ask the user which one.
- Their **user account** (for permissions): \`read\` SysAdminUnit — \`select: ["Id", "Name", "ContactId"], filters: { all: [{ field: "Name", op: "eq", value: "John Smith" }] }\`. Its \`ContactId\` is the same person's contact id.
- A **role**: \`read\` SysAdminUnit by role \`Name\` (e.g. "All employees"). \`SysAdminUnitTypeValue\` tells them apart: 4 = user (5 portal user, 7 service user); 0 organization, 1 division, 2 manager, 3 team, 6 functional role are roles.
`.trim();

const TAGGING_GUIDE = `
# Tagging records

Creatio keeps tags in one of two ways, and an instance usually has both:

| Storage | Tags | Links (tag ↔ record) |
|---|---|---|
| The object's own tag list | \`<Entity>Tag\` { Name } — e.g. \`ContactTag\` | \`<Entity>InTag\` { TagId, EntityId } |
| Shared tags | \`Tag\` { Name, EntitySchemaName } | \`TagInRecord\` { TagId, RecordId, RecordSchemaName } |

## 1. Choose the storage
1. The user named one → use it.
2. Otherwise use the one this object already uses. Count both over the whole object (\`count: true, top: 0\`, no record filter): \`<Entity>InTag\` (Account → \`AccountInTag\`, Contact → \`ContactInTag\`), and \`TagInRecord\` with \`RecordSchemaName\` = the entity. An unknown \`<Entity>InTag\` (unknown_entity) means only shared tags exist.
3. Both in use → ask the user in plain words: "Contacts keep tags in two places — their own tag list and Creatio's shared tags. Which should I use?" Neither in use (or no own list) → shared tags.

## 2. Add a tag
1. Find the tag by name — own list: \`read\` \`<Entity>Tag\` (e.g. \`AccountTag\`) by \`Name\`; shared: \`read\` \`Tag\` by \`Name\` and \`EntitySchemaName\` = the entity. Create it if missing — \`{ Name }\` / \`{ Name, EntitySchemaName }\` is all it needs — and mention that you created a new tag.
2. Skip if the record already has it: \`read\` the link table by the tag id and the record id.
3. Link:
   - own list: \`{ "entity": "ContactInTag", "data": { "TagId": "<tag id>", "EntityId": "<record id>" } }\`
   - shared: \`{ "entity": "TagInRecord", "data": { "TagId": "<tag id>", "RecordId": "<record id>", "RecordSchemaName": "Contact" } }\`

## 3. List or remove
- A record's tags: \`read\` the link table by \`EntityId\` / \`RecordId\` with \`select: ["Tag"]\` (DataService) or \`expand: ["Tag"]\` (OData).
- Removing a tag from a record deletes the link row, not the tag (other records may use it).
`.trim();

const SYS_SETTINGS_GUIDE = `
# System settings

## Find existing settings
\`read\` the \`VwSysSetting\` view — \`select: ["Id", "Code", "Name", "ValueTypeName", "IsPersonal", "IsCacheable"]\`, filtered by \`Code\` or \`Name\` with \`contains\`. Read values with \`query-sys-settings\` by code; change them with \`set-sys-settings-value\` (confirm with the user first — settings affect the whole instance).

## Create a setting
\`create-sys-setting { definition: { code, name, valueTypeName, … }, initialValue? }\`. \`valueTypeName\` is one of:

| valueTypeName | Shown in Creatio as |
|---|---|
| Text, ShortText, MediumText, LongText, MaxSizeText | Text (unlimited / 50 / 250 / 500 / unlimited) |
| SecureText | Encrypted string |
| Integer, Float, Money | Integer, Decimal, Currency |
| Boolean | Boolean |
| DateTime, Date, Time | Date/Time, Date, Time |
| Lookup | Lookup — also needs \`referenceSchemaUId\` |
| Binary | BLOB |

A Lookup setting points to an object by its schema UId: \`read\` \`VwWorkspaceObjects\` — \`select: ["UId", "Name"], filters: { all: [{ field: "Name", op: "eq", value: "Account" }] }\` — and pass \`UId\` as \`referenceSchemaUId\`.

## Change a definition
\`update-sys-setting-definition { id, definition }\` — Creatio requires \`code\`, \`name\` and \`valueTypeName\` every time; send the current values for those you keep.
`.trim();

const FEATURE_TOGGLE_GUIDE = `
# Feature toggles

A feature comes from a **source**: a DB row (\`DbFeatureProvider\`), \`web.config\`, package \`Metadata\` or \`GlobalAppSettings\`; a DB row always wins. Each feature has a **default state** (for everyone) and optional **overrides** for users or roles (\`SysAdminUnit\` ids — not contact ids).

Which tools you have depends on the server's CRUD backend:

| Backend | Tools | Sees |
|---|---|---|
| DataService (default) | \`list-features\`, \`get-feature\`, \`set-feature-state\` | features from every source (what the Creatio feature page shows) |
| OData | \`read\` / \`create\` / \`update\` / \`delete\` on the tables + \`refresh-feature-cache\` | only DB rows (\`Feature\` table) |

## DataService backend
1. Find: \`list-features { search }\` (part of the code), optionally \`source\` / \`enabledForCurrentUser\`; page with \`skip\` while \`hasMore\`.
2. Inspect: \`get-feature { code }\` — default state, the current user's state, \`overrides\`.
3. Change the default: \`set-feature-state { code, state: "enabled" | "disabled" }\`.
4. Override for a user or role: add \`adminUnitId\` (\`read\` SysAdminUnit by \`Name\` with \`SysAdminUnitTypeValue\` — contactid-guide tells users from roles; if the name matches several, ask which); remove it with \`state: "inherit"\`.
5. "Only for role X": the override turns it on for X, so the default must be off — if \`get-feature\` shows it enabled by default, ask before turning the default off. Other overrides listed by \`get-feature\` still apply; mention them.

\`set-feature-state\` clears the cache and re-reads the feature. \`cacheCleared: false\` means the change is saved but takes effect only after Creatio refreshes — tell the user. Changing a web.config / Metadata / GlobalAppSettings feature creates its DB row, which then takes precedence (the Creatio feature page does the same). A new feature: \`create\` a \`Feature\` row (\`Code\`, \`Name\`, \`DefaultState\`), then use the tools above.

## OData backend
Tables: \`Feature\` (\`Code\`, \`Name\`, \`Description\`, \`DefaultState\`) and \`AdminUnitFeatureState\` (\`FeatureId\`, \`SysAdminUnitId\`, \`FeatureState\`). States are integers: 0 = disabled, 1 = enabled.
- Change the default: \`update\` the \`Feature\` row → \`{ "DefaultState": 1 }\`.
- Override: \`read\` \`AdminUnitFeatureState\` by \`FeatureId\` + \`SysAdminUnitId\`; \`update\` it if it exists, else \`create\` it. Remove: \`delete\` the row.
- Delete a feature: its \`AdminUnitFeatureState\` rows first, then the \`Feature\` row.
- After every write: \`refresh-feature-cache { featureCode }\`, or users keep the old state.

A feature \`Code\` must match \`^[a-zA-Z]+[a-zA-Z0-9-_.]*$\`.
`.trim();

const ADMIN_OPERATION_GUIDE = `
# System operations (permissions)

System operations (\`SysAdminOperation\`: \`Code\`, \`Name\`, \`Description\`) gate admin abilities such as \`CanManageAdministration\` or \`CanUseODataService\`. Who may run one is in \`SysAdminOperationGrantee\` (\`SysAdminOperationId\`, \`SysAdminUnitId\`, \`CanExecute\`, \`Position\`).

Read both with \`read\`; write only with the dedicated tools — Creatio blocks the generic create / update / delete on these tables:

| Need | Tool |
|---|---|
| Create an operation, or rename / re-describe one | \`upsert-admin-operation\` (omit \`id\` to create; \`code\` is always required) |
| Delete operations (their grants go with them) | \`delete-admin-operation { ids }\` |
| Allow or deny for users / roles | \`set-admin-operation-grantee { adminOperationId, adminUnitIds, canExecute }\` |
| Remove a grant entirely | \`delete-admin-operation-grantee { ids }\` |

## Recipes
- Find an operation: \`read\` SysAdminOperation — \`select: ["Id", "Code", "Name"], filters: { all: [{ field: "Code", op: "eq", value: "CanManageAdministration" }] }\`.
- Its grants: \`read\` SysAdminOperationGrantee — \`select: ["Id", "SysAdminUnit", "CanExecute"], filters: { all: [{ field: "SysAdminOperationId", op: "eq", value: "<operation id>" }] }\`.
- A user or role to grant: \`read\` SysAdminUnit by \`Name\` → its \`Id\` (a SysAdminUnit id, not a contact id). Pass all of them in one \`adminUnitIds\` call.
- Flip allow ↔ deny: \`set-admin-operation-grantee\` again with the other \`canExecute\` — it updates the existing grant.

Confirm with the user before granting, denying or deleting, and re-read the rows afterwards to report the result.
`.trim();

interface Guide {
	readonly name: string;
	readonly title: string;
	readonly description: string;
	readonly text: string;
}

/** Every guide, by name. The names are the `get-guide` topics and the prompt names. */
export const GUIDES = [
	{
		name: 'query-guide',
		title: 'Querying Creatio data',
		description:
			'How to find the right entity and columns, read with filters / related columns / sorting / paging / counting, and present results with record links and attachments',
		text: QUERY_GUIDE,
	},
	{
		name: 'create-activity-guide',
		title: 'Creating activities',
		description:
			'Tasks, meetings and calls: owner, type and category ids, times, participants, and confirming to the user',
		text: CREATE_ACTIVITY_GUIDE,
	},
	{
		name: 'datetime-guide',
		title: 'Dates and time zones',
		description:
			'How record dates follow the user’s Creatio time zone, with write, filter and read examples',
		text: DATETIME_GUIDE,
	},
	{
		name: 'contactid-guide',
		title: 'People: contact id vs user id',
		description:
			'Which id a person field takes (a Contact id for owners/authors, a SysAdminUnit id for users and roles in permissions) and how to get the current user and other people',
		text: CONTACTID_GUIDE,
	},
	{
		name: 'tagging-guide',
		title: 'Tagging records',
		description:
			'Adding, listing and removing tags in the object’s own tag list or Creatio’s shared tags, and choosing between them',
		text: TAGGING_GUIDE,
	},
	{
		name: 'sys-settings-guide',
		title: 'System settings',
		description:
			'Finding, creating and changing system settings: value types, lookup settings, definitions',
		text: SYS_SETTINGS_GUIDE,
	},
	{
		name: 'feature-toggle-guide',
		title: 'Feature toggles',
		description:
			'Listing, inspecting and changing feature toggles (default state and per-user/role overrides) on the DataService and OData backends',
		text: FEATURE_TOGGLE_GUIDE,
	},
	{
		name: 'admin-operation-guide',
		title: 'System operations (permissions)',
		description:
			'Creating system operations (SysAdminOperation) and granting or denying them to users and roles',
		text: ADMIN_OPERATION_GUIDE,
	},
] as const satisfies readonly Guide[];

export type GuideName = (typeof GUIDES)[number]['name'];

export const GUIDE_NAMES = GUIDES.map((g) => g.name) as [GuideName, ...GuideName[]];

/** The guides as MCP prompts (user-invoked: `/query-guide`). */
export const ALL_PROMPTS = GUIDES.map((guide) => ({
	name: guide.name,
	title: guide.title,
	description: guide.description,
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: guide.text },
			},
		],
	}),
}));

/** The text of a guide, for the `get-guide` tool. */
export function guideText(name: GuideName): string {
	return GUIDES.find((g) => g.name === name)!.text;
}
