import { createHash } from 'node:crypto';

import log from '../../log';
import { getEffectiveUserKey, getInjectedCredential } from '../../utils/context';
import { CurrentUserInfo, UserProvider } from '../contracts';
import { UTC_ZONE, UserClock, ZoneRules, resolveUserZone, userInfoOf } from '../temporal';

import { VersionedTtlCache } from './versioned-ttl-cache';

/** Supplies the calling user's {@link UserClock} — what a CRUD provider converts dates with. */
export interface UserClockSource {
	current(): Promise<UserClock>;
}

/** A source for a fixed zone: tests, and providers built without a user context. */
export function fixedClockSource(zone: ZoneRules = UTC_ZONE): UserClockSource {
	const clock = new UserClock(zone);
	return { current: async () => clock };
}

// A user changes their profile zone rarely and by hand; a quarter of an hour bounds how long a
// change goes unnoticed while keeping it one GetCurrentUserInfo call per user per 15 minutes.
const ZONE_TTL_MS = 15 * 60 * 1000;
const MAX_ZONE_ENTRIES = 512;

/**
 * The calling user's clock, from their Creatio profile (`GetCurrentUserInfo`), cached per caller.
 * The cache key is the tenant base URL plus the caller: a hash of the injected credential in the
 * passthrough modes (their `userKey` is unverified, so it must not decide whose zone is served),
 * else the broker user, else the single configured identity.
 */
export class UserTimeZoneResolver implements UserClockSource {
	private readonly _user: UserProvider;
	private readonly _baseUrl: () => string;
	private readonly _cache = new VersionedTtlCache<UserClock>(ZONE_TTL_MS, MAX_ZONE_ENTRIES);

	constructor(user: UserProvider, baseUrl: () => string) {
		this._user = user;
		this._baseUrl = baseUrl;
	}

	private _callerKey(): string {
		const credential = getInjectedCredential();
		if (credential) {
			const material = credential.kind === 'bearer' ? credential.token : credential.cookie;
			return `c:${createHash('sha256').update(material).digest('base64url')}`;
		}
		return `u:${getEffectiveUserKey() ?? 'default'}`;
	}

	private async _load(): Promise<UserClock> {
		let body: CurrentUserInfo;
		try {
			body = await this._user.getCurrentUserInfo();
		} catch (err) {
			log.error('creatio.time_zone.unavailable', { error: String(err) });
			throw err;
		}
		const zone = resolveUserZone(body);
		if (zone.source !== 'zone') {
			const info = userInfoOf(body);
			log.warn('creatio.time_zone.fallback', {
				source: zone.source,
				timeZoneId: info?.timeZoneId,
				timeZoneOffsetHours: info?.timeZoneOffsetHours,
			});
		}
		return new UserClock(zone.rules);
	}

	public current(): Promise<UserClock> {
		return this._cache.getOrLoad(`${this._baseUrl()}::${this._callerKey()}`, '', () =>
			this._load(),
		);
	}
}
