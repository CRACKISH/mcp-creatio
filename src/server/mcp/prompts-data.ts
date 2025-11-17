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

⚠️⚠️⚠️ FIRST STEP - ALWAYS CALL get-current-user-info FIRST! ⚠️⚠️⚠️

Before creating ANY activity, you MUST:
1. Call 'get-current-user-info' tool (no parameters)
2. Extract contactId from response
3. Store contactId in memory
4. Use contactId as OwnerId and AuthorId in the activity

DO NOT skip this step! Activities require valid OwnerId and AuthorId (both = contactId).

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
## 👤 STEP 2: Resolve ContactId (Owner/Author) - USE get-current-user-info!

🎯 **DEFAULT BEHAVIOR: Activities are ALWAYS created for the current user!**

Unless the user **explicitly** requests to create an activity for someone else (e.g., "create a task for John", "schedule meeting for Anna"), 
**ALWAYS** use the current user's ContactId as both OwnerId and AuthorId.

### Get Current User ContactId:

**MANDATORY FIRST CALL:** Use \`get-current-user-info\` tool:

STEP 1: Call \`get-current-user-info\` (no parameters) ← DO THIS NOW if not done yet!
STEP 2: Extract \`contactId\` from response
STEP 3: Use contactId for OwnerId & AuthorId

**Alternative (Legacy):** Query SysAdminUnit once for ContactId (NOT Id!). Store and reuse.

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
     "filter": "contains(Name, 'John')",
     "select": ["Id", "Name"],
     "top": 1
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

## 🎯 The Workflow (RECOMMENDED!)

### 🔑 DEFAULT RULE: Current User by Default!

**ALWAYS assume activities/tasks/leads/opportunities are for the CURRENT USER unless explicitly told otherwise!**

Examples:
- ❌ "Create task" → DO NOT ask "for whom?" → Create for current user!
- ❌ "Schedule meeting tomorrow" → DO NOT ask "whose meeting?" → Current user's meeting!
- ✅ "Create task for John" → Only THEN create for someone else
- ✅ "Schedule meeting with Anna as owner" → Only THEN change owner

**This is the expected behavior! Don't annoy users by asking obvious questions.**

### Step 1: Use get-current-user-info Tool (BEST METHOD!)

**RECOMMENDED:** Use the dedicated tool to get user information:

Call \`get-current-user-info\` tool (no parameters needed)

**Returns:**
\`\`\`json
{
  "userId": "410006e1-ca4e-4502-a9ec-e54d922d2c00",
  "contactId": "76929f8c-7e15-4c64-bdb0-adc62d383727",  // ← USE THIS!
  "userName": "Supervisor",
  "cultureName": "en-US"
}
\`\`\`

**Why this is better:**
- ✅ Single call, all info
- ✅ No need to know username
- ✅ Gets ContactId directly
- ✅ More reliable
- ✅ Use contactId for ALL Owner/Author fields by default

### Alternative: Query SysAdminUnit (Legacy Method)

If you need to query manually:

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

### Step 2: Store ContactId in Memory

Remember the ContactId for the entire conversation:

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
# 🏷️ Tagging Records in Creatio

## 🚨 CRITICAL DECISION: Which Tag System?

Creatio has TWO tagging systems that may coexist:

### 1️⃣ LEGACY System (Entity-Specific) - **DEFAULT & RECOMMENDED**
- Uses: \`<Entity>Tag\` and \`<Entity>InTag\` tables
- Examples: \`ActivityTag\` + \`ActivityInTag\`, \`AccountTag\` + \`AccountInTag\`
- Fields: \`TagId\` (from <Entity>Tag), \`EntityId\` (record GUID)
- **Use this by DEFAULT unless user explicitly asks for universal tags!**

### 2️⃣ NEW System (Universal)
- Uses: \`Tag\` and \`TagInRecord\` tables
- Fields: \`TagId\`, \`RecordId\`, \`RecordSchemaName\`
- Only use if user specifically says "use universal tags" or "use new tag system"

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

export const ALL_PROMPTS = [
	CREATE_ACTIVITY_PROMPT,
	DATETIME_PROMPT,
	CONTACTID_PROMPT,
	TAGGING_PROMPT,
	SYS_SETTINGS_PROMPT,
] as const;
