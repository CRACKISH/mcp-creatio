/**
 * The MCP `instructions` sent on initialize: the few rules a client should give the model before
 * any tool is called (clients typically add them to the system prompt). Tool descriptions and the
 * guides (`get-guide`) carry the details; keep this short. Shaped by blind evaluations: each rule
 * answers a question a model got wrong or had to guess from the tools alone.
 */
export const SERVER_INSTRUCTIONS = [
	'This server reads and changes data in a Creatio CRM instance as one Creatio user (get-current-user-info tells you who); Creatio applies that user’s permissions, so counts and lists cover what this user can see. It cannot send emails, messages or invitations — give results in your reply.',
	'Dates and times: record dates are in the user’s Creatio time zone, exactly as the Creatio UI shows them. Reads return them with that zone’s offset ("2026-11-10T14:00:00+02:00"); a time you send without an offset ("2026-11-10T14:00:00") is taken in that zone. Do not convert times to UTC or ask the user for a time zone. For "today", "tomorrow", "this month" or "overdue" use userInfo.now / userInfo.today from get-current-user-info, not your own clock. When you present or confirm times, say they are in the user’s Creatio time zone (userInfo.timeZone).',
	'Before multi-step work, read the matching guide with get-guide: query-guide (finding entities and columns, filters, counting), create-activity-guide (tasks, meetings, calls), datetime-guide, contactid-guide (owner vs user ids), tagging-guide, sys-settings-guide, feature-toggle-guide, admin-operation-guide. A tool a description mentions but your tool list lacks (dataforge-*, global-search) is not available on this instance.',
	'Never guess ids: look them up with read. If several records match a name, ask which one. Records the user creates for themselves are owned by their contact (userInfo.contactId). Ordinary creates and updates the user asked for need no extra confirmation; confirm before deleting anything and before changing system settings, permissions or feature toggles. State assumptions you make (e.g. "10" read as 10:00, a default duration).',
	'Give the user a link (get-record-url) to the records you name — for a long list, the first few and the count.',
].join('\n\n');
