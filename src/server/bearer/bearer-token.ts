import jwt from 'jsonwebtoken';

/**
 * Lightweight, crypto-free inspection of an incoming Bearer token.
 *
 * In the stateless per-request model the Bearer is a Creatio access token. Creatio remains the
 * cryptographic authority (it rejects bad/expired tokens with 401), so the MCP only needs a stable
 * per-request identity (for session mapping/logging) and a cheap obviously-expired guard. Strict
 * signature checking is the separate, opt-in {@link JwksTokenValidator}.
 */
export interface DecodedBearer {
	/** A stable identity for the token: `sub` claim when present, else a short fingerprint. */
	userKey: string;
	/** Expiry (epoch seconds) if the token is a JWT with `exp`. */
	expSeconds?: number;
	/** Whether the token parsed as a JWT (vs an opaque/reference token). */
	isJwt: boolean;
}

/** Extracts a stable userKey + optional expiry from a Bearer token without verifying its signature. */
export function inspectBearer(token: string): DecodedBearer {
	const decoded = safeDecode(token);
	if (decoded && typeof decoded === 'object') {
		const sub = typeof decoded.sub === 'string' ? decoded.sub : undefined;
		const exp = typeof decoded.exp === 'number' ? decoded.exp : undefined;
		return {
			userKey: sub ?? fingerprint(token),
			...(exp !== undefined ? { expSeconds: exp } : {}),
			isJwt: true,
		};
	}
	return { userKey: fingerprint(token), isJwt: false };
}

/** True when a JWT's `exp` is in the past (with a small skew), so we can fail fast before calling Creatio. */
export function isExpired(
	decoded: DecodedBearer,
	nowMs: number = Date.now(),
	skewSeconds = 30,
): boolean {
	if (decoded.expSeconds === undefined) {
		return false;
	}
	return nowMs / 1000 > decoded.expSeconds + skewSeconds;
}

function safeDecode(token: string): (jwt.JwtPayload & Record<string, unknown>) | null {
	try {
		const decoded = jwt.decode(token);
		return decoded && typeof decoded === 'object' ? (decoded as jwt.JwtPayload) : null;
	} catch {
		return null;
	}
}

/**
 * A short, non-reversible fingerprint of an opaque token, used only as a per-request session key.
 * Not security-sensitive (the token itself is the credential); it just needs to be stable + opaque.
 */
function fingerprint(token: string): string {
	let hash = 0;
	for (let i = 0; i < token.length; i++) {
		hash = (hash * 31 + token.charCodeAt(i)) | 0;
	}
	return `tok_${(hash >>> 0).toString(36)}`;
}
