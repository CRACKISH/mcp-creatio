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
# 🆕 Create Activity in Creatio (Optimized 99% Case)

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
1. Query ActivityCategory by Name (e.g. filter: "Name eq 'Meeting'") select Id top 1
2. Use returned Id as ActivityCategoryId

Do NOT query ActivityType unless user demands non-Task type explicitly.

---
## 👤 STEP 2: Resolve ContactId (Owner/Author)

Get current user's ContactId once (SysAdminUnit → ContactId). Store and reuse for OwnerId & AuthorId.
Never use SysAdminUnit.Id for Owner/Author.

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
    "PriorityId": "${DEFAULT_ACTIVITY_IDS.PRIORITY_MEDIUM}"
  }
}
\`\`\`

If user supplies duration only (e.g. 30m) → compute DueDate = StartDate + duration.

---
## ✅ Example (Meeting intent, fast mode)

User: "Schedule meeting tomorrow 14:00" → ask timezone → user: "UTC+2" → 14:00 UTC+2 = 12:00Z.
1. Resolve ContactId (SysAdminUnit query once)
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
# 👤 ContactId Rule - UNIVERSAL for ALL Creatio Entities

## 🚨 CRITICAL RULE (Read This First!)

In Creatio, there are TWO types of IDs:

1. **SysAdminUnit.Id** = User account ID (for login/permissions)
2. **SysAdminUnit.ContactId** = Contact ID (for CRM records)

### For CRM fields, ALWAYS use ContactId!

This applies to **ALL entities**, not just Activity:
- Activity.OwnerId = ContactId ✅
- Activity.AuthorId = ContactId ✅
- Lead.OwnerId = ContactId ✅
- Opportunity.OwnerId = ContactId ✅
- Case.OwnerId = ContactId ✅
- Account.OwnerId = ContactId ✅

---

## 🎯 The Workflow (Do This Once!)

### Step 1: Get ContactId at the Start of Session

Query SysAdminUnit to get the ContactId:

\`\`\`json
{
  "entity": "SysAdminUnit",
  "filter": "Name eq 'Supervisor'",
  "select": ["ContactId"],
  "top": 1
}
\`\`\`

**Returns:**
\`\`\`json
[{
  "ContactId": "76929f8c-7e15-4c64-bfb1-40c705d25fcd"
}]
\`\`\`

### Step 2: Store ContactId in Variable

\`\`\`typescript
const currentUserContactId = "76929f8c-7e15-4c64-bfb1-40c705d25fcd";
\`\`\`

### Step 3: Use This ContactId EVERYWHERE

For **ANY** entity that has owner/author/creator fields:

\`\`\`json
{
  "entity": "Activity",
  "data": {
    "OwnerId": currentUserContactId,    // ← ContactId
    "AuthorId": currentUserContactId    // ← ContactId
  }
}
\`\`\`

\`\`\`json
{
  "entity": "Lead",
  "data": {
    "OwnerId": currentUserContactId     // ← ContactId
  }
}
\`\`\`

\`\`\`json
{
  "entity": "Opportunity", 
  "data": {
    "OwnerId": currentUserContactId     // ← ContactId
  }
}
\`\`\`

---

## ❌ Common Mistake

### WRONG (using SysAdminUnit.Id):
\`\`\`json
// Step 1: Query SysAdminUnit
read("SysAdminUnit", "Name eq 'Supervisor'", ["Id"], 1)
// → Returns: [{ "Id": "410006e1-ca4e-4502-a9ec-e54d922d2c00" }]

// Step 2: Use .Id (WRONG!)
create("Activity", {
  "OwnerId": "410006e1-ca4e-4502-a9ec-e54d922d2c00"  // ❌ This is user ID!
})
// → ERROR: Invalid reference or constraint violation!
\`\`\`

### ✅ CORRECT (using ContactId):
\`\`\`json
// Step 1: Query SysAdminUnit  
read("SysAdminUnit", "Name eq 'Supervisor'", ["ContactId"], 1)
// → Returns: [{ "ContactId": "76929f8c-7e15-4c64-bfb1-40c705d25fcd" }]

// Step 2: Use .ContactId (CORRECT!)
create("Activity", {
  "OwnerId": "76929f8c-7e15-4c64-bfb1-40c705d25fcd"  // ✅ This is contact ID!
})
// → SUCCESS!
\`\`\`

---

## 🔍 Visual Explanation

\`\`\`
SysAdminUnit "Supervisor":
├─ Id: "410006e1..."          ← USER account (for system/permissions)
│  └─ Used for: Login, roles, access rights
│
└─ ContactId: "76929f8c..."   ← CONTACT record (for CRM)
   └─ Used for: Activities, Leads, Opportunities, Owners, Authors

Contact "John Doe":
└─ Id: "76929f8c..."           ← Same as SysAdminUnit.ContactId!
   └─ This is the CRM person record
\`\`\`

---

## 📋 When to Use Each ID

| Field Type                    | Use This        | Example Entity         |
|-------------------------------|-----------------|------------------------|
| OwnerId                       | **ContactId**   | Activity, Lead, Case   |
| AuthorId                      | **ContactId**   | Activity               |
| CreatedById                   | **ContactId**   | Any entity             |
| ModifiedById                  | **ContactId**   | Any entity             |
| ContactId (in Activity)       | **ContactId**   | Activity               |
| ParticipantId                 | **ContactId**   | ActivityParticipant    |
| ResponsibleId                 | **ContactId**   | Lead, Opportunity      |
| System permissions/roles      | **Id**          | SysAdminUnit relations |

**Rule of thumb:** If it's a CRM field → **ContactId**. Always.

---

## 🎯 Best Practice

At the **start of any workflow** that needs user identity:

1. Query \`SysAdminUnit\` once
2. Select \`["ContactId"]\`
3. Store in variable
4. Use everywhere

**Don't query multiple times!** One query per session is enough.

---

## ⚠️ What If I Used Wrong ID?

You'll see errors like:
- "Foreign key constraint violation"
- "Invalid reference"
- "Record not found"
- Owner field is empty or points to wrong person

**Solution:** Go back and use ContactId instead of Id!

---

## 💡 Summary

- **SysAdminUnit.Id** = User account (system)
- **SysAdminUnit.ContactId** = Contact person (CRM)
- **For CRM fields** → ALWAYS use ContactId
- **Query once** → Use everywhere
- **This rule applies** → ALL entities in Creatio

Remember: **ContactId, not Id!** 🎯
`.trim();

const TAGGING_GUIDE = `
# 🏷️ Tagging Records in Creatio (New + Legacy Systems)

User intents: "tag this record with <tag>", "add tag <tag> to <entity>", "label this activity as <tag>".

## 🔎 Step 1: Identify Target Entity & Record
1. Extract the entity name from context or user text (e.g. Activity, Contact, Account, Opportunity, Case...).
2. If user did not supply the record Id:
	- Ask clarifying question (preferred), OR
	- Use search/read to locate by unique field (Title/Number/Name) and confirm with user.
3. Store the resolved record GUID → recordId.

## 🧭 Step 2: Detect Available Tag System(s)
Creatio now has a **new universal tag system** plus some entities may retain a **legacy per-entity tag schema**.

| System  | Entities (core)                  | Linking Entity  | Tag Entity    | Link Fields (core)                 |
|---------|----------------------------------|-----------------|--------------|-----------------------------------|
| New     | Tag, TagInRecord                 | TagInRecord     | Tag          | TagId, RecordId, RecordSchemaName |
| Legacy  | <Entity>Tag, <Entity>InTag       | <Entity>InTag   | <Entity>Tag  | TagId, EntityId                   |

### 2.1 Check Presence
Assume new system (Tag, TagInRecord) exists.
Then probe for legacy pair: <Entity>Tag AND <Entity>InTag (e.g. ActivityTag, ActivityInTag).

### 2.2 Choose System
- Only new present → use new (no question).
- Both present → ask user: "Which tagging system should be used: new (universal) or legacy (entity-specific)?" (default = new if indifferent).

Persist decision: useLegacy = true|false.

## 🏷️ Step 3: Normalize & Resolve Tag(s)
1. Extract tag phrase(s) (quoted, comma‑separated, or single words).
2. Normalize: trim whitespace; keep natural case.
3. For each tagName:
	- New: read Tag where Name eq 'tagName' select Id.
	- Legacy: read <Entity>Tag where Name eq 'tagName' select Id.
4. If not found → ask: "Create new tag 'tagName'?" (unless user explicitly instructed creation) then:
	- New: create Tag { Name: 'tagName' }
	- Legacy: create <Entity>Tag { Name: 'tagName' }
5. Keep map tagName → tagId.

## ✅ Step 4: Check Existing Link
For each tagId:
- New: read TagInRecord (TagId, RecordId, RecordSchemaName) to detect existing link.
- Legacy: read <Entity>InTag with TagId & EntityId.
Skip creation if already linked.

## ➕ Step 5: Create Link(s)
- New: create TagInRecord { TagId, RecordId, RecordSchemaName: 'EntityName' }.
- Legacy: create <Entity>InTag { TagId, EntityId: recordId }.

## 🧾 Step 6: Report
Return summary: entity, recordId (or human label), added tags, skipped (already existed), system used.

## 🔁 Multiple Tags
Split, de‑duplicate, resolve sequentially; escape single quotes in OData filters (replace ' with '').

## 🧪 Examples
New system:
1) Read Tag (not found) → create Tag.
2) Read TagInRecord (none) → create TagInRecord.
Legacy system:
1) Read ActivityTag (found) → read ActivityInTag (none) → create ActivityInTag.

## ⚠️ Edge Cases
- Duplicate tag names in request → process once.
- Mixed language or ambiguous phrase → confirm before creating new tag.
- User gives natural key (e.g. Title) → resolve record Id first.
- Tag already linked → do not create again.

## ❌ Avoid
- Blind tag creation without checking existence.
- Using wrong record field (must be RecordId / EntityId as per system).
- Skipping system choice when legacy also exists.

## ✅ Checklist
- [ ] Entity resolved
- [ ] Record Id
- [ ] System chosen
- [ ] Tag(s) resolved/created
- [ ] Existing links checked
- [ ] Missing links created
- [ ] Summary output

Prefer structured filters for reliability and reuse tagId cache within one request.
`.trim();

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
	title: 'ContactId Rule for All Entities',
	description:
		'CRITICAL: Always use SysAdminUnit.ContactId (not .Id!) for all CRM fields across all entities',
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

export const ALL_PROMPTS = [
	CREATE_ACTIVITY_PROMPT,
	DATETIME_PROMPT,
	CONTACTID_PROMPT,
	TAGGING_PROMPT,
] as const;
