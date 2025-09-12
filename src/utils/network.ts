import type express from 'express';

export function getClientIp(req: express.Request): string | undefined {
	const forwarded = req.headers['x-forwarded-for'] as string | string[] | undefined;
	if (forwarded) {
		if (Array.isArray(forwarded)) return forwarded[0];
		const parts = forwarded.split(',').map((s) => s.trim());
		if (parts.length) return parts[0];
	}

	if (req.ip) return req.ip;
	if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
	return undefined;
}

export default { getClientIp };
