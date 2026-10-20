import { CurrentUserInfo } from '../contracts';

import { UserClock } from './user-clock';
import { toIanaZone } from './windows-zones';
import { UTC_ZONE, ZoneRules, fixedOffsetZone, formatOffset, ianaZone } from './zone-rules';

/** How a profile's zone was settled. `offset` = Creatio's current offset only (no daylight-saving
 *  rules); `utc` = Creatio named no zone at all. */
export type UserZoneSource = 'zone' | 'offset' | 'utc';

export interface UserZone {
	readonly rules: ZoneRules;
	readonly source: UserZoneSource;
	/** The IANA zone, when the profile's zone maps to one this runtime can apply. */
	readonly timeZone?: string;
}

const HOUR_MS = 60 * 60 * 1000;

export function userInfoOf(body: CurrentUserInfo): CurrentUserInfo {
	return body?.userInfo && typeof body.userInfo === 'object' ? body.userInfo : body;
}

/**
 * The zone of a `GetCurrentUserInfo` answer. `timeZoneId` is the profile's Windows (or IANA) zone;
 * `timeZoneOffsetHours` is Creatio's own CURRENT offset for it — right only for dates on the same
 * side of a daylight-saving change, so it is the fallback, and the check that the mapped zone is
 * the one Creatio applies (an offset no instant within an hour of now has means the mapping is
 * wrong for this server, and Creatio's offset is the safer answer).
 */
export function resolveUserZone(body: CurrentUserInfo, now: number = Date.now()): UserZone {
	const info = userInfoOf(body);
	const hours = Number(info?.timeZoneOffsetHours);
	const reported = Number.isFinite(hours) ? Math.round(hours * 60) : undefined;
	const timeZone = toIanaZone(typeof info?.timeZoneId === 'string' ? info.timeZoneId : undefined);
	if (timeZone) {
		const rules = ianaZone(timeZone);
		const agrees =
			reported === undefined ||
			[now - HOUR_MS, now, now + HOUR_MS].some((t) => rules.offsetMinutesAt(t) === reported);
		if (agrees) {
			return { rules, source: 'zone', timeZone };
		}
	}
	return reported === undefined
		? { rules: UTC_ZONE, source: 'utc' }
		: { rules: fixedOffsetZone(reported), source: 'offset' };
}

/**
 * The zone fields `get-current-user-info` adds for the model: the IANA zone, today's offset, and the
 * user's current date and time — what "tomorrow", "this month" or "overdue" are relative to (the
 * model's own clock may be in another zone, or unknown).
 */
export function describeUserZone(
	body: CurrentUserInfo,
	now: number = Date.now(),
): { timeZone?: string; utcOffset: string; now: string; today: string } {
	const zone = resolveUserZone(body, now);
	const wholeSecond = new Date(Math.floor(now / 1000) * 1000).toISOString();
	const local = String(new UserClock(zone.rules).fromInstant('datetime', wholeSecond));
	return {
		...(zone.timeZone ? { timeZone: zone.timeZone } : {}),
		utcOffset: formatOffset(zone.rules.offsetMinutesAt(now)),
		now: local,
		today: local.slice(0, 10),
	};
}
