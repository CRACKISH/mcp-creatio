import { CookieKV } from '../types';

import type express from 'express';

export function getClientIp(req: express.Request): string | undefined {
	const forwarded = req.headers['x-forwarded-for'] as string | string[] | undefined;
	if (forwarded) {
		if (Array.isArray(forwarded)) {
			return forwarded[0];
		}
		const parts = forwarded.split(',').map((s) => s.trim());
		if (parts.length) {
			return parts[0];
		}
	}
	if (req.ip) {
		return req.ip;
	}
	if (req.socket && req.socket.remoteAddress) {
		return req.socket.remoteAddress;
	}
	return undefined;
}

export function parseSetCookie(setCookie: string[]): CookieKV[] {
	const out: CookieKV[] = [];
	for (const raw of setCookie || []) {
		const first = raw.split(';')[0]?.trim();
		if (!first) {
			continue;
		}
		const idx = first.indexOf('=');
		if (idx > 0) {
			out.push({ name: first.slice(0, idx), value: first.slice(idx + 1) });
		}
	}
	return out;
}

export function getUserKeyFromRequest(req: express.Request): string | undefined {
	const fromHeader = req.headers['x-user-key'];
	if (typeof fromHeader === 'string' && fromHeader) {
		return fromHeader;
	}
	const fromQuery = (req.query as any)?.userKey;
	if (typeof fromQuery === 'string' && fromQuery) {
		return fromQuery;
	}

	const sessionId = getSessionIdFromRequest(req as any);
	if (sessionId) {
		return `user_${sessionId}`; // session-based userKey
	}

	return undefined;
}

export function getSessionIdFromRequest(req: any) {
	return (
		req.headers['mcp-session-id'] ||
		req.query?.session_id ||
		req.headers['x-session-id'] ||
		req.body?.params?.session_id ||
		req.body?.session_id ||
		null
	);
}
