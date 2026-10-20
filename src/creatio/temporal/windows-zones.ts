import { WINDOWS_TO_IANA } from './windows-zones.data';
import { isSupportedZone } from './zone-rules';

// Windows zones Creatio still ships in its `TimeZone` lookup that CLDR no longer maps (verified on
// 10.2 .NET Framework and .NET 8: every other code of the table is in CLDR).
const RETIRED_WINDOWS_ZONES: ReadonlyMap<string, string> = new Map([
	['Kamchatka Standard Time', 'Asia/Kamchatka'],
	['Mid-Atlantic Standard Time', 'Etc/GMT+2'],
]);

/**
 * The IANA zone for a Creatio profile time-zone id. Creatio stores a Windows id
 * (`SysAdminUnit.TimeZoneId`, e.g. "FLE Standard Time") but also accepts an IANA name there, so
 * both resolve. `undefined` when the id names no zone this runtime can apply.
 */
export function toIanaZone(timeZoneId: string | undefined): string | undefined {
	if (!timeZoneId) {
		return undefined;
	}
	const iana =
		WINDOWS_TO_IANA.get(timeZoneId) ?? RETIRED_WINDOWS_ZONES.get(timeZoneId) ?? timeZoneId;
	return isSupportedZone(iana) ? iana : undefined;
}
