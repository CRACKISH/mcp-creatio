const DEFAULT_ACTIVITY_IDS = {
	TYPE_TASK: 'fbe0acdc-cfc0-df11-b00f-001d60e938c6',
	CATEGORY_TODO: 'f2c0ce0e-cfc1-df11-b00f-001d60e938c6',
	STATUS_NOT_STARTED: '384d4b84-58e6-df11-971b-001d60e938c6',
	PRIORITY_MEDIUM: 'ab96fa02-7fe6-df11-971b-001d60e938c6',
} as const;

const ACTIVITY_TYPE_TABLE = `
| User says / intent | TypeId → Type (fixed) | Category (set via ActivityCategoryId) |
|--------------------|-----------------------|---------------------------------------|
| task / todo (default) | Task                | To do                                 |
| meeting / meet / sync | Task                | Meeting                               |
| call / phone          | Task                | Call                                  |
| email / mail          | Task                | Email                                 |

💡 We deliberately keep Type always = Task for speed. Change only if user explicitly insists: "Use real meeting type".
`.trim();

const CREATE_ACTIVITY_WORKFLOW = `
# Create an activity in Creatio

First get the current user once with \`get-current-user-info\` and reuse it: an activity needs \`OwnerId\` and \`AuthorId\`, both \`userInfo.contactId\` (the contact id, not \`userInfo.id\`) unless the user names someone else.

## Why Simplified?
Business usage: almost all activities should just appear in calendar quickly. So we hardcode **Type = Task** and only adjust the **Category** to reflect intent (meeting / call / email / todo). This minimizes API calls and cognitive load.

If user explicitly insists: "Use real meeting type" / "Set actual Call type" → THEN switch to extended lookup mode (ActivityType + ActivityCategory must match). Otherwise stay in fast mode.

⚠️ ABSOLUTE RULE:
Always set **TypeId = Task** for intents like "meeting", "meet", "sync", "call", "phone", "email", "mail", "todo", "task" UNLESS (and only unless) the user explicitly demands a non-Task type using phrases such as:
"real meeting type", "actual meeting type", "true call type", "use real ActivityType", "not a task", "change the Type itself", "use Visit type", "use Call type id".

Plain requests like "create a meeting", "schedule a call", "create email follow-up" DO *NOT* justify changing Type. Treat them as Category changes only.

🚫 NEVER perform ActivityType lookups for Meeting/Call/Email unless escalation trigger is present. Doing so wastes calls and breaks the 99% optimization goal.

❌ WRONG (for ordinary meeting request): Query ActivityType 'Visit' then set TypeId=Visit.
✅ RIGHT: Keep TypeId=Task; lookup only ActivityCategory 'Meeting'.

---
## 📋 STEP 1: Parse Intent → Decide Category (Type fixed = Task)

Ask (if unclear): "What kind of activity? (task / meeting / call / email)". Default = task.

${ACTIVITY_TYPE_TABLE}

GUIDs we already have (hardcoded):
- TypeId (Task): ${DEFAULT_ACTIVITY_IDS.TYPE_TASK}
- Default Category (To do): ${DEFAULT_ACTIVITY_IDS.CATEGORY_TODO}
- Default Status (Not started): ${DEFAULT_ACTIVITY_IDS.STATUS_NOT_STARTED}
- Default Priority (Medium): ${DEFAULT_ACTIVITY_IDS.PRIORITY_MEDIUM}

If category ≠ To do (e.g. Meeting / Call / Email) and you don't have its GUID cached:
1. \`read\` ActivityCategory: \`select: ["Id"], filters: { all: [{ field: "Name", op: "eq", value: "Meeting" }] }, top: 1\`
2. Use returned Id as ActivityCategoryId

Do NOT query ActivityType unless user demands non-Task type explicitly.

---
## 👤 STEP 2: Resolve ContactId (Owner/Author) - USE get-current-user-info!

🎯 **DEFAULT BEHAVIOR: Activities are ALWAYS created for the current user!**

Unless the user **explicitly** requests to create an activity for someone else (e.g., "create a task for John", "schedule meeting for Anna"), 
**ALWAYS** use the current user's ContactId as both OwnerId and AuthorId.

### Get Current User ContactId:

Call \`get-current-user-info\` (no parameters) once and use \`userInfo.contactId\` for OwnerId and AuthorId.

⚠️ CRITICAL: 
- Never use SysAdminUnit.Id for Owner/Author fields. Always use ContactId!
- By default, OwnerId = AuthorId = current user's ContactId
- Only change if user explicitly says "for [other person]"

See /contactid-guide prompt for detailed explanation.

---
## ⏰ STEP 3: Timezone Handling

Always confirm timezone → convert to UTC → ISO 8601 with Z. See /datetime-guide for full details.

---
## 🔨 STEP 4: Construct Payload

Base payload:
\`\`\`json
{
  "entity": "Activity",
  "data": {
    "Title": "<title>",
    "TypeId": "${DEFAULT_ACTIVITY_IDS.TYPE_TASK}",
    "ActivityCategoryId": "<category-guid>",
    "StartDate": "<utc-start>",
    "DueDate": "<utc-due>",
    "StatusId": "${DEFAULT_ACTIVITY_IDS.STATUS_NOT_STARTED}",
    "OwnerId": "<contactId>",
    "AuthorId": "<contactId>",
    "PriorityId": "${DEFAULT_ACTIVITY_IDS.PRIORITY_MEDIUM}",
    "ShowInScheduler": true
  }
}
\`\`\`

**CRITICAL:** Always set \`"ShowInScheduler": true\` for meetings/calls/events so they appear in the calendar!
Only set to false if user explicitly requests the activity to be hidden from calendar.

If user supplies duration only (e.g. 30m) → compute DueDate = StartDate + duration.

---
## 👥 STEP 5: Add Participants (Optional)

If user requests to add participants to a meeting/call/activity:
- User says: "add John to the meeting", "invite Anna", "add participant [Name]"

### How to Add Participants:

1. **Find the Contact:** Query Contact entity by Name to get ContactId
   \`\`\`json
   {
     "entity": "Contact",
     "filters": { "all": [{ "field": "Name", "op": "contains", "value": "John" }] },
     "select": ["Id", "Name"],
     "top": 5
   }
   \`\`\`

2. **Create ActivityParticipant record:**
   \`\`\`json
   {
     "entity": "ActivityParticipant",
     "data": {
       "ActivityId": "<activity-guid>",
       "ParticipantId": "<contact-guid>"
     }
   }
   \`\`\`

⚠️ **IMPORTANT:**
- ActivityId = GUID of the Activity (meeting/call/task)
- ParticipantId = ContactId of the person to add
- **NO other fields needed!** Just these two fields are sufficient.
- You can add multiple participants by creating multiple ActivityParticipant records

### Example:
User: "Add John and Mary to tomorrow's meeting"
1. Create Activity → get activityId
2. Find Contact "John" → get johnContactId
3. Create ActivityParticipant { ActivityId: activityId, ParticipantId: johnContactId }
4. Find Contact "Mary" → get maryContactId
5. Create ActivityParticipant { ActivityId: activityId, ParticipantId: maryContactId }

---
## ✅ Example (Meeting intent, fast mode)

User: "Schedule meeting tomorrow 14:00" → ask timezone → user: "UTC+2" → 14:00 UTC+2 = 12:00Z.
1. Resolve the owner: \`get-current-user-info\` → \`userInfo.contactId\` (once)
2. Lookup ActivityCategory 'Meeting' (if not cached)
3. Create with Type=Task, Category=Meeting

---
## 🔁 Escalation to Extended Mode (Rare)
Trigger only if user supplies explicit escalation phrase (contains one of: "real", "actual", "true", "non-task", "not a task", "use real type", "use Visit type", "use Call type", "change the TypeId"). Simple intent words (meeting/call/email) are NOT escalation.
If triggered:
1. Query ActivityType by Name (Call / Email / Visit)
2. Query matching ActivityCategory
3. Replace TypeId with looked up Id. (Ensure combination is valid.)

---
## 🚨 Common Mistakes
❌ Unnecessary lookups for Meeting/Call when fast mode sufficient
❌ Using SysAdminUnit.Id instead of ContactId
❌ Skipping timezone confirmation
❌ Forgetting Z suffix
❌ Mismatching explicit non-Task request (ignore only if user accepts fast mode)
❌ Adding extra fields to ActivityParticipant (only ActivityId + ParticipantId needed!)
❌ Forgetting to create ActivityParticipant records when user asks to add participants

---
## 🧠 Decision Heuristics
If user is vague: default Category = To do.
If keywords: "meeting", "meet", "sync" → Meeting category.
"call", "phone" → Call category.
"email", "mail" → Email category.
Explicit: "task" / nothing → To do.

Return the minimal number of read calls (cache category GUIDs when first resolved in session).
`.trim();

const DATETIME_GUIDE = `
# ⏰ DateTime and Timezone Guide for Creatio

## The Problem
You do NOT automatically know the user's timezone! 
Dates in Creatio must be stored in UTC with ISO 8601 format.

---

## ✅ The Solution: Always Ask!

### Step 1: Identify Date/Time from User
User says: "Create meeting tomorrow at 2pm"
- Tomorrow = calculate date
- 2pm = time in **user's local timezone**

### Step 2: Ask for Timezone
**You:** "What timezone are you in?"

**User might say:**
- "UTC+3" or "GMT+3"
- "Europe/Kiev" or "Europe/Warsaw"  
- "EST" or "PST"
- "My local time is 2pm now" (calculate offset)

### Step 3: Convert to UTC
Formula: **UTC = Local Time - Offset**

Examples:
- 2pm UTC+3 → 2pm - 3h = **11am UTC**
- 9am UTC-5 (EST) → 9am - (-5h) = 9am + 5h = **2pm UTC**
- 10pm UTC+0 → **10pm UTC** (no conversion)

### Step 4: Format as ISO 8601 with Z suffix
Format: \`YYYY-MM-DDTHH:mm:ss**Z**\`

Examples:
- \`2024-01-16T11:00:00Z\`
- \`2024-12-25T14:30:00Z\`
- \`2025-03-01T00:00:00Z\`

**The Z suffix means UTC!** Never omit it.

---

## 📋 Common Timezone Reference

| Timezone          | Offset  | Example: 2pm local → UTC |
|-------------------|---------|--------------------------|
| UTC+0 (London)    | +0      | 2pm → 2pm UTC            |
| UTC+1 (Paris)     | +1      | 2pm → 1pm UTC            |
| UTC+2 (Kyiv)      | +2      | 2pm → 12pm UTC           |
| UTC+3 (Moscow)    | +3      | 2pm → 11am UTC           |
| UTC-5 (EST/NY)    | -5      | 2pm → 7pm UTC            |
| UTC-8 (PST/LA)    | -8      | 2pm → 10pm UTC           |

---

## 💡 Conversation Examples

### Example 1: Clear timezone
**User:** "Create task tomorrow at 9am EST"
**You:** *(recognize EST = UTC-5)*
- Tomorrow = 2024-01-16
- 9am EST = 9am + 5h = 2pm UTC
- Store: \`"StartDate": "2024-01-16T14:00:00Z"\`

### Example 2: Ask for clarification
**User:** "Meeting at 3pm"
**You:** "What timezone are you in?"
**User:** "UTC+3"
**You:** *(calculate)*
- 3pm UTC+3 = 3pm - 3h = 12pm UTC
- Store: \`"StartDate": "2024-01-16T12:00:00Z"\`

### Example 3: Relative time
**User:** "Create task in 2 hours"
**You:** "What timezone?"
**User:** "It's 4pm here, UTC+2"
**You:** *(calculate)*
- Now: 4pm UTC+2 = 2pm UTC
- In 2 hours: 2pm + 2h = 4pm UTC
- Store: \`"StartDate": "2024-01-16T16:00:00Z"\`

---

## 🚨 Critical Rules

1. ⚠️ **ALWAYS ask timezone** - never assume!
2. ⚠️ **ALWAYS use Z suffix** - indicates UTC
3. ⚠️ **Subtract offset for east** (UTC+) - e.g., UTC+3 → subtract 3
4. ⚠️ **Add offset for west** (UTC-) - e.g., UTC-5 → add 5
5. ⚠️ **Store in UTC** - Creatio expects UTC, not local time

---

## 🎯 Quick Checklist

Before storing ANY date in Creatio:
- [ ] Asked user for timezone?
- [ ] Converted local time to UTC?
- [ ] Used ISO 8601 format?
- [ ] Added Z suffix?
- [ ] Double-checked offset direction?

If all ✅ → Good to go!
`.trim();

const CONTACTID_GUIDE = `
# People in Creatio: contact id vs user id

A person who uses Creatio has two records, and each kind of field wants a different one:

| Record | Id | Used by |
|--------|----|---------|
| **Contact** (the person in the CRM) | \`userInfo.contactId\` | Owner, Author, Responsible, Manager, CreatedBy, ParticipantId — every CRM lookup to a person |
| **SysAdminUnit** (the login account / role) | \`userInfo.id\` | users and roles in permissions: \`set-feature-state\`, \`set-admin-operation-grantee\` |

Putting a user id into an owner field fails (or points at nobody) — owner/author fields always take the **contact** id.

## The current user
Call \`get-current-user-info\` once and reuse the answer for the conversation:

\`\`\`json
{ "success": true, "userInfo": { "id": "<SysAdminUnit id>", "contactId": "<Contact id>", "contactName": "…", "timeZoneOffsetHours": 2, "…": "…" } }
\`\`\`

Records the user creates for themselves (tasks, meetings, leads, opportunities, cases) get their contact id as owner and author. Do not ask "for whom?" — only use someone else when the user says so ("a task for John").

\`\`\`json
{ "entity": "Activity", "data": { "Title": "Call Acme", "OwnerId": "<userInfo.contactId>", "AuthorId": "<userInfo.contactId>" } }
\`\`\`

## Someone else
- Their **contact**: \`read\` Contact — \`select: ["Id", "Name"], filters: { all: [{ field: "Name", op: "contains", value: "John" }] }\`. If several match, ask the user which one.
- Their **user account** (for permissions): \`read\` SysAdminUnit — \`select: ["Id", "Name", "ContactId"], filters: { all: [{ field: "Name", op: "eq", value: "John Smith" }] }\`. Its \`ContactId\` is the same person's contact id.
- A **role**: \`read\` SysAdminUnit by role \`Name\` (e.g. "All employees").
`.trim();

const TAGGING_GUIDE = `
# 🏷️ Tagging Records in Creatio

## 🚨 CRITICAL DECISION: Which Tag System?

Creatio has TWO tagging systems that may coexist:

### 1️⃣ LEGACY System (Entity-Specific)
- Uses: \`<Entity>Tag\` and \`<Entity>InTag\` tables
- Examples: \`ActivityTag\` + \`ActivityInTag\`, \`AccountTag\` + \`AccountInTag\`
- Fields: \`TagId\` (from <Entity>Tag), \`EntityId\` (record GUID)

### 2️⃣ NEW System (Universal)
- Uses: \`Tag\` and \`TagInRecord\` tables
- Fields: \`TagId\`, \`RecordId\`, \`RecordSchemaName\`

Which one to use is decided by the flow below: the only system that exists, the one the user named, or — when both exist — the user's answer.

---

## ⚡ Quick Decision Flow

**MANDATORY behavior:**
1. Check if \`<Entity>Tag\` exists (e.g., \`ActivityTag\`)
2. If BOTH systems exist (Legacy AND Universal):
   → **ALWAYS ASK USER**: "Which tagging system should I use: legacy (ActivityTag/ActivityInTag) or universal (Tag/TagInRecord)?"
   → Wait for explicit user response - NO DEFAULT!
   → User must choose: "legacy" or "universal"
3. If ONLY legacy exists → Use legacy (no question needed)
4. If ONLY universal exists → Use universal (no question needed)

**CRITICAL:** Never auto-choose when both systems are available! Always ask and wait for clear answer!

---

## 📋 STEP-BY-STEP WORKFLOW

### Step 1: Identify Target Entity & Record
- Extract entity name (Activity, Contact, Account, etc.)
- Get record GUID (from context or ask user)
- Store as: \`entityName\`, \`recordId\`

### Step 2: Choose System (MANDATORY CHECK!)

**Always perform this check:**

1. Try describe-entity on \`<Entity>Tag\` (e.g., "ActivityTag")
2. Try describe-entity on \`Tag\` 
3. Determine availability:
   - BOTH exist → **ASK USER MANDATORY**: "I found both tagging systems. Which one should I use: legacy (<Entity>Tag) or universal (Tag)?"
   - ONLY legacy exists → Use legacy automatically
   - ONLY universal exists → Use universal automatically
   - NEITHER exists → Error (cannot tag)

**User response handling:**
- "legacy" / "old" / "entity-specific" / "<Entity>Tag" → useLegacy = true
- "universal" / "new" / "Tag" / "TagInRecord" → useLegacy = false
- If unclear response → Ask again for clarification

**NEVER skip the question when both systems are present!**
**NEVER assume a default - wait for explicit user choice!**

### Step 3: Resolve or Create Tag

**Tag name can be ANY value provided by user** (e.g., "VIP", "Urgent", "Follow-up", "Important", etc.)

**For LEGACY system:**
1. Try to find existing tag: read <Entity>Tag where Name eq '<TagName>' select Id top 1
2. If not found, create it: create <Entity>Tag with Name: "<TagName>"
3. Returns tag Id (GUID)

**For UNIVERSAL system:**
1. Try to find existing tag: read Tag where Name eq '<TagName>' and EntitySchemaName eq '<Entity>' select Id top 1
2. If not found, create it: create Tag with Name: "<TagName>", EntitySchemaName: "<Entity>"
3. Returns tag Id (GUID)

### Step 4: Check if Already Tagged
Avoid duplicate links!

**LEGACY:**
- read <Entity>InTag where TagId eq <tag-guid> and EntityId eq <record-guid> select Id top 1

**UNIVERSAL:**
- read TagInRecord where TagId eq <tag-guid> and RecordId eq <record-guid> select Id top 1

### Step 5: Create Link (if not exists)

**LEGACY:**
- create <Entity>InTag with TagId: <tag-guid>, EntityId: <record-guid>

**UNIVERSAL:**
- create TagInRecord with TagId: <tag-guid>, RecordId: <record-guid>, RecordSchemaName: "<Entity>"

---

## 💡 Examples

### Example 1: Add "VIP" tag to Activity (Standard Request)

User: "Add tag VIP to this meeting"

LLM Actions:
1. Detect: Entity = Activity, recordId from context
2. Check: ActivityTag exists? YES. Tag exists? YES (BOTH found!)
3. ASK USER: "Which tagging system should I use: legacy (ActivityTag) or universal (Tag)?"
4. User: "legacy"
5. Query: ActivityTag where Name='VIP' (found: "9dd32c9f...")
6. Check: ActivityInTag link exists? NO
7. Create: ActivityInTag with TagId: "9dd32c9f...", EntityId: "meeting-id"
8. Report: "Added VIP tag to meeting using legacy system"

### Example 2: User explicitly wants universal system

User: "Add tag Important using the new universal tag system"

LLM Actions:
1. User specified "new universal" (useLegacy = false, skip question!)
2. Query: Tag where Name='Important' and EntitySchemaName='Activity'
3. If not found: Create Tag with Name: "Important", EntitySchemaName: "Activity"
4. Create: TagInRecord with TagId, RecordId, RecordSchemaName: "Activity"
5. Report: "Added Important tag using universal system"

### Example 3: Legacy system doesn't exist

User: "Add tag to CustomEntity"

LLM Actions:
1. Check: CustomEntityTag exists? NO
2. Auto-fallback: Use universal system
3. Query/Create in Tag table
4. Link via TagInRecord

---

## 🚨 Common Mistakes to Avoid

❌ **WRONG:** Auto-choosing system when both exist
✅ **RIGHT:** ALWAYS ask user when both legacy and universal are available

❌ **WRONG:** Creating duplicate tags without checking
✅ **RIGHT:** Always check existence first

❌ **WRONG:** Not checking if link already exists
✅ **RIGHT:** Query <Entity>InTag or TagInRecord before creating

❌ **WRONG:** Skipping the mandatory question
✅ **RIGHT:** If both systems exist, MUST ask user which one to use

---

## 📊 Quick Reference Table

| Entity    | Tag Table      | Link Table        | Tag Field | Record Field |
|-----------|----------------|-------------------|-----------|--------------|
| Activity  | ActivityTag    | ActivityInTag     | TagId     | EntityId     |
| Account   | AccountTag     | AccountInTag      | TagId     | EntityId     |
| Contact   | ContactTag     | ContactInTag      | TagId     | EntityId     |
| Lead      | LeadTag        | LeadInTag         | TagId     | EntityId     |
| Case      | CaseTag        | CaseInTag         | TagId     | EntityId     |
| *Universal* | Tag          | TagInRecord       | TagId     | RecordId     |

---

## ✅ Final Checklist

Before creating a tag link:
- [ ] Entity and record GUID identified
- [ ] System auto-detected (legacy preferred)
- [ ] Tag resolved or created in correct table
- [ ] Existing link checked (no duplicates)
- [ ] Link created in correct table
- [ ] User notified of success

---

## 🎯 Remember

**The Golden Rule:** When BOTH systems exist - ALWAYS ASK USER (no defaults!)

Question format: "I found both tagging systems for <Entity>. Which should I use: legacy (<Entity>Tag) or universal (Tag)?"

**Wait for explicit answer!** Do not proceed until user chooses.

Only skip question if:
- ONLY legacy exists → Use legacy automatically
- ONLY universal exists → Use universal automatically
- User already specified in original request (e.g., "use new tag system")

**Tag names:** Can be ANY value user provides (VIP, Urgent, Important, Follow-up, etc.)

**DO NOT assume or auto-choose when both are present!**
`.trim();

const SYS_SETTINGS_VALUE_TYPES_TABLE = `
| valueTypeName | Display label           |
| ------------- | ----------------------- |
| Binary        | BLOB                    |
| Boolean       | Boolean                 |
| DateTime      | Date/Time               |
| Date          | Date                    |
| Time          | Time                    |
| Integer       | Integer                 |
| Money         | Currency (0.01)         |
| Float         | Decimal                 |
| Lookup        | Lookup                  |
| ShortText     | Text (50 characters)    |
| MediumText    | Text (250 characters)   |
| LongText      | Text (500 characters)   |
| Text          | Text                    |
| MaxSizeText   | Unlimited length text   |
| SecureText    | Encrypted string        |
`.trim();

const SYS_SETTINGS_GUIDE = `
# ⚙️ Creating Creatio System Settings

## Supported valueTypeName values
Always use the **value** column (not the display label) when filling \`definition.valueTypeName\`.

${SYS_SETTINGS_VALUE_TYPES_TABLE}

## Discovering existing system settings
To inspect what system settings already exist (names, codes, value types, cache flags, etc.), query the 
\`VwSysSetting\` view via the standard \`read\` tool. Example:

\`\`\`json
{
	"entity": "VwSysSetting",
	"select": [
		"Id",
		"Name",
		"Code",
		"Description",
		"ValueTypeName",
		"IsPersonal",
		"IsCacheable"
	],
	"top": 50
}
\`\`\`

Filter by \`Code\` or \`Name\` to narrow results (e.g., \`"filters":{"all":[{"field":"Code","op":"contains","value":"Product"}]}\`).
This is the fastest way to learn which settings already exist before inserting new ones.

## Lookup referenceSchemaUId
- Required only when \`valueTypeName = "Lookup"\`.
- Set \`definition.referenceSchemaUId\` to the EntitySchema UId of the lookup target.
- Fetch the UId from \`VwWorkspaceObjects\` by filtering on the schema name.

### Example MCP read request
\`\`\`json
{
	"entity": "VwWorkspaceObjects",
	"filters": {
		"all": [
			{ "field": "Name", "op": "eq", "value": "Account" }
		]
	},
	"select": ["UId", "Name", "Caption"]
}
\`\`\`

Use the returned \`UId\` as \`referenceSchemaUId\` inside the \`create-sys-setting\` tool payload.

## Quick workflow reminder
1. Insert sys setting metadata via \`create-sys-setting\`.
2. Optionally include \`initialValue\` to write the first value immediately.
3. For additional updates later, call \`set-sys-settings-value\`.
`.trim();

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
| A column of a related record | \`select: ["Name", "Account.Name"]\` (on the OData backend: \`expand: ["Account"]\`) |
| Filter by a related record's id | \`{ field: "AccountId", op: "eq", value: "<guid>" }\` |
| Filter by a related record's name | \`{ field: "Account.Name", op: "eq", value: "Acme" }\` |
| Text search in a column | \`{ field: "Name", op: "contains", value: "acme" }\` (case-insensitive) |
| One of several values | \`{ field: "Stage.Name", in: ["Presentation", "Negotiation"] }\` |
| Empty / not empty | \`{ field: "Email", op: "eq", value: null }\` / \`op: "ne"\` |
| A date range | \`{ field: "CreatedOn", op: "ge", value: "2026-01-01T00:00:00Z" }\` + \`op: "lt"\` for the end (UTC, /datetime-guide) |
| AND / OR | \`filters: { all: [...], any: [...] }\` — \`all\` is AND, \`any\` is OR, and the two groups are combined by AND |
| Newest / biggest first | \`orderBy: "CreatedOn desc"\`, \`orderBy: "Amount desc, Title asc"\` |
| "How many …?" | \`count: true, top: 0\` → \`{ total, value: [] }\` — never page through rows to count them |
| The next page | same query with \`skip\` += \`top\` and a stable \`orderBy\` |

What comes back:
- A missing value is \`null\` (a text column may also be \`""\`).
- A lookup column you select by itself (\`Account\`) is \`{ value, displayValue }\` on the DataService backend; on OData select its id (\`AccountId\`) and \`expand\` the record for its name.
- Ids are GUIDs. Never invent one: resolve a lookup value by reading its table (\`ActivityPriority\` by \`Name\`) or with \`dataforge-lookup-values\`.

## 4. Present the results
- Mentioning a specific record? Add its link: \`get-record-url { entity, id }\`.
- The user asks about a record's documents? \`list-record-files { entity, id }\` lists its files and links; hand the user the \`downloadUrl\`.
- Prefer names over ids in your answer; keep ids for follow-up calls.

## 5. People: user id vs contact id
Owner / author / responsible columns point to a **Contact**: use \`userInfo.contactId\` from \`get-current-user-info\` for the current user. Tools that take a user or role (\`set-feature-state\`, \`set-admin-operation-grantee\`) want a **SysAdminUnit** id: \`userInfo.id\`. See /contactid-guide.
`.trim();

export const QUERY_PROMPT = {
	name: 'query-guide',
	title: 'Querying Creatio data',
	description:
		'How to find the right entity and columns, read with filters / related columns / sorting / paging / counting, and present results with record links and attachments',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: QUERY_GUIDE },
			},
		],
	}),
};

export const CREATE_ACTIVITY_PROMPT = {
	name: 'create-activity-guide',
	title: 'Create Activity in Creatio',
	description:
		'Complete step-by-step guide for creating Activities (tasks/meetings/calls) in Creatio',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: {
					type: 'text' as const,
					text: CREATE_ACTIVITY_WORKFLOW,
				},
			},
		],
	}),
};
export const DATETIME_PROMPT = {
	name: 'datetime-guide',
	title: 'DateTime and Timezone Guide',
	description: 'How to ask users for timezone and convert to UTC for Creatio',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: {
					type: 'text' as const,
					text: DATETIME_GUIDE,
				},
			},
		],
	}),
};

export const CONTACTID_PROMPT = {
	name: 'contactid-guide',
	title: 'People: contact id vs user id',
	description:
		'Which id a person field takes (a Contact id for owners/authors, a SysAdminUnit id for users and roles in permissions) and how to get the current user and other people',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: {
					type: 'text' as const,
					text: CONTACTID_GUIDE,
				},
			},
		],
	}),
};

export const TAGGING_PROMPT = {
	name: 'tagging-guide',
	title: 'Tagging Records (New & Legacy Systems)',
	description:
		'Guide for adding tags to records using Tag/TagInRecord or legacy <Entity>Tag / <Entity>InTag tables',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: TAGGING_GUIDE },
			},
		],
	}),
};

export const SYS_SETTINGS_PROMPT = {
	name: 'sys-settings-guide',
	title: 'Creatio System Settings Guide',
	description:
		'Value type options and lookup reference instructions for create-sys-setting / set-sys-settings-value workflows',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: SYS_SETTINGS_GUIDE },
			},
		],
	}),
};

const FEATURE_TOGGLE_GUIDE = `
# 🚦 Feature Toggling Guide for Creatio

## 🧭 Quick Map

A feature can come from several **sources**: a DB row (\`DbFeatureProvider\`), \`web.config\`, package \`Metadata\`, or \`GlobalAppSettings\`. A DB row always wins over the others. Each feature has a **default state** (for everyone) and optional **per-user/role overrides** (\`SysAdminUnit\` — a user or a role).

Which tools you have depends on the server's CRUD backend:

| Backend                    | Tools                                                                 | Sees                  |
|----------------------------|-----------------------------------------------------------------------|-----------------------|
| DataService (default)      | \`list-features\`, \`get-feature\`, \`set-feature-state\`                    | Features from **every** source |
| OData                      | generic \`read\` / \`create\` / \`update\` / \`delete\` + \`refresh-feature-cache\` | Only DB rows (\`Feature\` table) |

If \`list-features\` is available, use it — it is the same data the Creatio feature page shows.

---

## ✅ DataService backend (feature tools)

1. **Find a feature:** \`list-features\` with \`search\` (substring of the code), optionally \`source\` / \`enabledForCurrentUser\`; page with \`skip\` while \`hasMore\` is true.
2. **Inspect it:** \`get-feature { code }\` → default state, effective state for the MCP user, \`overrides\`.
3. **Change the default:** \`set-feature-state { code, state: "enabled" | "disabled" }\`.
4. **Override for a user/role:** \`set-feature-state { code, state, adminUnitId }\` — \`adminUnitId\` is \`SysAdminUnit.Id\` (NOT a ContactId); resolve it with \`read\` on \`SysAdminUnit\` filtered by \`Name\`.
5. **Remove an override:** \`set-feature-state { code, state: "inherit", adminUnitId }\`.

\`set-feature-state\` clears that feature's cache and returns the re-read feature, so no \`refresh-feature-cache\` is needed. If the result has \`cacheCleared: false\`, the change is saved but the instance could not clear its cache (seen on .NET 8): it may take effect only after Creatio refreshes — tell the user. Changing a \`web.config\` / \`Metadata\` / \`GlobalAppSettings\` feature creates its \`Feature\` DB row; from then on the DB value takes precedence over the original source — exactly what the Creatio feature page does.

To create a brand-new feature, \`create\` a \`Feature\` row (\`Code\`, \`Name\`, \`DefaultState\`), then use the tools above.

---

## 🗄️ OData backend (tables)

Only DB-backed features are reachable: \`Feature\` (catalog: \`Code\`, \`Name\`, \`Description\`, \`DefaultState\`) and \`AdminUnitFeatureState\` (overrides: \`FeatureId\`, \`SysAdminUnitId\`, \`FeatureState\`). \`DefaultState\` / \`FeatureState\` are **Int32: 0 = disabled, 1 = enabled** — never booleans.

- **List / find:** \`read\` on \`Feature\` (filter \`Code\`).
- **Change the default:** \`update\` \`Feature\` → \`{ "DefaultState": 1 }\`.
- **Override for a user/role:** \`read\` \`AdminUnitFeatureState\` by \`FeatureId\` + \`SysAdminUnitId\`; \`update\` the row if it exists, otherwise \`create\` it.
- **Remove an override:** \`delete\` that \`AdminUnitFeatureState\` row.
- **Delete a feature:** delete its \`AdminUnitFeatureState\` rows first, then the \`Feature\` row.

After **every** write call \`refresh-feature-cache\` with the feature \`Code\` (or with no arguments to clear all), otherwise users keep seeing the old state.

---

## ❌ Common Mistakes

- ❌ Passing a \`ContactId\` as \`adminUnitId\` / \`SysAdminUnitId\` — overrides use \`SysAdminUnit.Id\`.
- ❌ Reading only the \`Feature\` table on the DataService backend — it misses web.config / metadata features; use \`list-features\`.
- ❌ (OData) Sending \`true\`/\`false\` for \`DefaultState\` / \`FeatureState\`, or forgetting \`refresh-feature-cache\` after a write.
- ❌ (OData) Creating a duplicate \`AdminUnitFeatureState\` for the same \`(FeatureId, SysAdminUnitId)\` instead of updating it.
- ❌ A \`Code\` not matching \`^[a-zA-Z]+[a-zA-Z0-9-_.]*$\` — the platform validator rejects it.
`.trim();

export const FEATURE_TOGGLE_PROMPT = {
	name: 'feature-toggle-guide',
	title: 'Creatio Feature Toggle Guide',
	description:
		'How to list, inspect and change Creatio feature toggles (default state and per-user/role overrides) on the DataService and OData backends, and when to call refresh-feature-cache',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: FEATURE_TOGGLE_GUIDE },
			},
		],
	}),
};

const ADMIN_OPERATION_GUIDE = `
# 🛡️ Creatio System Operations (SysAdminOperation) Guide

## 🧭 Quick Map

Creatio system operations are admin-level permission flags that gate features such as \`CanUseODataService\`, \`CanManageAdministration\`, \`CanChangeAdminOperationGrantee\`, etc. They live in two database tables:

| Table                       | Holds                                                          | OData reachable? |
|-----------------------------|----------------------------------------------------------------|------------------|
| \`SysAdminOperation\`         | The operation definition: Name, Code, Description              | Read ✅ / Write ❌ |
| \`SysAdminOperationGrantee\`  | Per-admin-unit grants (FK to operation + SysAdminUnit + allow) | Read ✅ / Write ❌ |

Modification of both tables is blocked through OData v4 (\`DataServiceRestrictedModifySchemas\` in \`Web.config\`). All writes go through Creatio's dedicated **\`/0/rest/RightsService/\`** endpoints, wrapped by these MCP tools:

| Need                                     | Tool                                  |
|------------------------------------------|---------------------------------------|
| Read catalog / grant rows                | Standard \`read\` on the two entities  |
| Create or rename an operation            | \`upsert-admin-operation\`             |
| Delete operation(s)                      | \`delete-admin-operation\`             |
| Grant or revoke for users/roles          | \`set-admin-operation-grantee\`        |
| Remove a specific grant row by Id        | \`delete-admin-operation-grantee\`     |

⚠️ Do NOT attempt \`create\` / \`update\` / \`delete\` on \`SysAdminOperation\` or \`SysAdminOperationGrantee\` through the generic OData tools — Creatio rejects those writes.

---

## 📋 SysAdminOperation Columns

| Column          | Type     | Notes                                                              |
|-----------------|----------|--------------------------------------------------------------------|
| \`Id\`            | Guid     | Primary key                                                        |
| \`Code\`          | string   | Operation code, e.g., \`CanUseODataService\`. Conventionally PascalCase. |
| \`Name\`          | string   | Display name                                                       |
| \`Description\`   | string   | Optional description                                               |

## 📋 SysAdminOperationGrantee Columns

| Column                  | Type    | Notes                                                                       |
|-------------------------|---------|-----------------------------------------------------------------------------|
| \`Id\`                    | Guid    | Primary key                                                                 |
| \`SysAdminOperationId\`   | Guid    | FK to \`SysAdminOperation\`                                                   |
| \`SysAdminUnitId\`        | Guid    | FK to \`SysAdminUnit\` (use SysAdminUnit.Id, NOT ContactId)                   |
| \`CanExecute\`            | bool    | \`true\` = allow, \`false\` = deny                                            |
| \`Position\`              | Int32   | Order within conflicting rules; lower wins for the same admin unit          |

---

## 🛠️ Common Workflows

### 1. List system operations

\`\`\`json
{
  "entity": "SysAdminOperation",
  "select": ["Id", "Code", "Name", "Description"],
  "top": 200,
  "orderBy": "Code asc"
}
\`\`\`

### 2. Look up an operation by code

\`\`\`json
{
  "entity": "SysAdminOperation",
  "filters": { "all": [ { "field": "Code", "op": "eq", "value": "CanUseODataService" } ] },
  "select": ["Id", "Code", "Name", "Description"],
  "top": 1
}
\`\`\`

### 3. Create a new system operation

Call \`upsert-admin-operation\` without an \`id\`:

\`\`\`json
{
  "name": "Can do MCP test",
  "code": "CanDoMcpTest",
  "description": "Demo operation managed via MCP"
}
\`\`\`

The response includes the generated \`id\`. Capture it for the grant step.

### 4. Rename / re-describe an existing operation

Call \`upsert-admin-operation\` with the existing \`id\`:

\`\`\`json
{
  "id": "<operation-guid>",
  "name": "Can do MCP test (renamed)",
  "code": "CanDoMcpTest",
  "description": "Updated description"
}
\`\`\`

Code is required even when unchanged.

### 5. Grant the operation to a user or role

Resolve the SysAdminUnit first:

\`\`\`json
{
  "entity": "SysAdminUnit",
  "filters": { "all": [ { "field": "Name", "op": "eq", "value": "Supervisor" } ] },
  "select": ["Id", "Name", "SysAdminUnitTypeValue"],
  "top": 1
}
\`\`\`

Then call \`set-admin-operation-grantee\`:

\`\`\`json
{
  "adminOperationId": "<operation-guid>",
  "adminUnitIds": ["<sysadminunit-guid-1>", "<sysadminunit-guid-2>"],
  "canExecute": true
}
\`\`\`

Use \`canExecute: false\` to deny instead of allow. The service upserts the grantee rows internally — repeated calls for the same pair update the existing row instead of duplicating it.

### 6. Inspect current grants for an operation

⚠️ **Filter via the navigation property, not the raw FK column.** Creatio OData v4 rejects direct \`SysAdminOperationId eq <guid>\` / \`SysAdminUnitId eq <guid>\` filters on this entity with HTTP 500. Use \`SysAdminOperation/Id\` and \`SysAdminUnit/Id\` instead:

\`\`\`json
{
  "entity": "SysAdminOperationGrantee",
  "filters": { "all": [ { "field": "SysAdminOperation/Id", "op": "eq", "value": "<operation-guid>" } ] },
  "select": ["Id", "SysAdminOperationId", "SysAdminUnitId", "CanExecute", "Position"]
}
\`\`\`

### 7. Remove a specific grant row

Use the row Id from step 6:

\`\`\`json
{ "ids": ["<grantee-guid>"] }
\`\`\`

Call \`delete-admin-operation-grantee\`. Prefer toggling \`canExecute\` via \`set-admin-operation-grantee\` if the goal is to flip allow ↔ deny rather than fully remove the rule.

### 8. Delete an operation entirely

\`\`\`json
{ "ids": ["<operation-guid-1>", "<operation-guid-2>"] }
\`\`\`

Call \`delete-admin-operation\`. RightsService cascades cleanup of related grantee rows.

---

## ❌ Common Mistakes

- ❌ Trying to write to \`SysAdminOperation\` or \`SysAdminOperationGrantee\` via the generic OData \`create\` / \`update\` / \`delete\` tools — these tables are in \`DataServiceRestrictedModifySchemas\`.
- ❌ Passing the all-zero GUID as \`id\` to \`upsert-admin-operation\` to "create" — RightsService rejects it. Omit \`id\` and let the tool generate a fresh one.
- ❌ Using \`ContactId\` instead of \`SysAdminUnit.Id\` for grantees.
- ❌ Forgetting to confirm with \`read\` that the change landed — RightsService responses return \`success: true\` only when the underlying entity actually saved.
- ❌ Granting the operation to many units one by one — pass the full \`adminUnitIds\` array in a single call.
- ❌ Filtering \`SysAdminOperationGrantee\` by the raw \`SysAdminOperationId\` / \`SysAdminUnitId\` columns — Creatio OData returns HTTP 500 for those. Use the navigation property syntax \`SysAdminOperation/Id\` / \`SysAdminUnit/Id\`.

---

## ✅ Final Checklist

Before reporting a system-operation change as done:
- [ ] Used \`SysAdminOperation\` / \`SysAdminOperationGrantee\` only for reading.
- [ ] Used \`upsert-admin-operation\` / \`delete-admin-operation\` for catalog writes.
- [ ] Used \`set-admin-operation-grantee\` / \`delete-admin-operation-grantee\` for grants.
- [ ] Resolved each principal through \`SysAdminUnit\` (Id, not ContactId).
- [ ] Re-read the affected rows to confirm the change landed.
`.trim();

export const ADMIN_OPERATION_PROMPT = {
	name: 'admin-operation-guide',
	title: 'Creatio System Operations (SysAdminOperation) Guide',
	description:
		'How to manage SysAdminOperation and SysAdminOperationGrantee via the dedicated RightsService tools (upsert/delete operation, set/delete grantee), with reads still routed through the standard OData read tool',
	argsSchema: {},
	callback: () => ({
		messages: [
			{
				role: 'user' as const,
				content: { type: 'text' as const, text: ADMIN_OPERATION_GUIDE },
			},
		],
	}),
};

export const ALL_PROMPTS = [
	QUERY_PROMPT,
	CREATE_ACTIVITY_PROMPT,
	DATETIME_PROMPT,
	CONTACTID_PROMPT,
	TAGGING_PROMPT,
	SYS_SETTINGS_PROMPT,
	FEATURE_TOGGLE_PROMPT,
	ADMIN_OPERATION_PROMPT,
] as const;
