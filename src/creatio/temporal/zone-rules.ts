const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The offset rules of one time zone. */
export interface ZoneRules {
	/** The IANA zone, or `UTC` / `UTC±hh:mm` for a fixed offset. */
	readonly name: string;
	/** Minutes east of UTC at the instant `utcMs` (daylight saving included). */
	offsetMinutesAt(utcMs: number): number;
}

/** `+02:00` / `-09:30` / `+00:00` for an offset in minutes. */
export function formatOffset(offsetMinutes: number): string {
	const sign = offsetMinutes < 0 ? '-' : '+';
	const abs = Math.abs(offsetMinutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');
	return `${sign}${hh}:${mm}`;
}

export function fixedOffsetZone(offsetMinutes: number): ZoneRules {
	return {
		name: offsetMinutes === 0 ? 'UTC' : `UTC${formatOffset(offsetMinutes)}`,
		offsetMinutesAt: () => offsetMinutes,
	};
}

export const UTC_ZONE: ZoneRules = fixedOffsetZone(0);

// One formatter per zone: building an Intl.DateTimeFormat is the expensive part. Bounded by the
// number of IANA zones the runtime knows (a few hundred).
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		});
		formatters.set(zone, formatter);
	}
	return formatter;
}

/** Whether this runtime can apply the rules of the IANA zone `zone`. */
export function isSupportedZone(zone: string): boolean {
	try {
		formatterFor(zone);
		return true;
	} catch {
		return false;
	}
}

/** The rules of an IANA zone, from the runtime's own tz database. Throws on an unknown zone. */
export function ianaZone(zone: string): ZoneRules {
	const formatter = formatterFor(zone);
	return {
		name: zone,
		offsetMinutesAt(utcMs: number): number {
			const parts: Record<string, number> = {};
			for (const part of formatter.formatToParts(utcMs)) {
				parts[part.type] = Number(part.value);
			}
			const wall = Date.UTC(
				parts.year!,
				parts.month! - 1,
				parts.day!,
				parts.hour!,
				parts.minute!,
				parts.second!,
			);
			return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / MINUTE_MS);
		},
	};
}

/** The wall clock (as UTC-epoch milliseconds of its digits) of the instant `utcMs` in `zone`. */
export function utcToWallClock(utcMs: number, zone: ZoneRules): number {
	return utcMs + zone.offsetMinutesAt(utcMs) * MINUTE_MS;
}

/** Every instant whose wall clock in `zone` is `wallMs`: none in a spring-forward gap, two in a
 *  fall-back hour. A zone changes its offset at most once within a day either side. */
function instantsOf(wallMs: number, zone: ZoneRules): number[] {
	const offsets = new Set([
		zone.offsetMinutesAt(wallMs - DAY_MS),
		zone.offsetMinutesAt(wallMs),
		zone.offsetMinutesAt(wallMs + DAY_MS),
	]);
	return [...offsets]
		.map((offset) => wallMs - offset * MINUTE_MS)
		.filter((utcMs) => utcToWallClock(utcMs, zone) === wallMs);
}

/**
 * The instant Creatio stores for the wall clock `wallMs` of `zone`, resolved exactly as the
 * platform does (`DateTimeDataValueType.GetValueForSave` → .NET `TimeZoneInfo.ConvertTimeToUtc`):
 * a wall clock that occurs twice (the repeated fall-back hour) is its STANDARD-time, i.e. later,
 * occurrence; one skipped by a spring-forward is moved an hour forward first.
 */
export function wallClockToUtc(wallMs: number, zone: ZoneRules): number {
	const exact = instantsOf(wallMs, zone);
	if (exact.length) {
		return Math.max(...exact);
	}
	const shifted = instantsOf(wallMs + HOUR_MS, zone);
	return shifted.length
		? Math.max(...shifted)
		: wallMs + HOUR_MS - zone.offsetMinutesAt(wallMs) * MINUTE_MS;
}
