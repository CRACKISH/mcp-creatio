/**
 * The MCP `instructions` sent on initialize: the few rules a client should give the model before
 * any tool is called (clients typically add them to the system prompt). Tool descriptions and the
 * /…-guide prompts carry the details; keep this short.
 */
export const SERVER_INSTRUCTIONS = [
	'This server works with a Creatio CRM instance as the signed-in Creatio user.',
	'Dates and times: record dates are in the user’s Creatio profile time zone, exactly as the Creatio UI shows them. Reads return them with that zone’s offset ("2026-11-10T14:00:00+02:00"); a time you send without an offset ("2026-11-10T14:00:00") is taken in that zone. Do not convert times to UTC or ask the user for a time zone. When you present or confirm times, say they are in the user’s Creatio time zone (get-current-user-info → userInfo.timeZone), especially when it may differ from where the user is. Details: /datetime-guide.',
	'Records owned by the user (activities, tasks) take the user’s contact id from get-current-user-info (userInfo.contactId). Querying: /query-guide.',
].join('\n\n');
