import { randomUUID } from 'crypto';

import log from '../../log';
import { getClientIp } from '../../utils';

import { RateLimiter } from './rate-limiter';

import type { RateLimitOptions } from './rate-limiter';
import type { NextFunction, Request, Response } from 'express';

/** Single-use / credential query params that must never reach the logs (CWE-532) — the OAuth
 *  `/authorize` and `/oauth/callback` URLs carry `code`/`state`/verifier in the query string. */
const SENSITIVE_QUERY_PARAMS = new Set([
	'code',
	'state',
	'token',
	'access_token',
	'refresh_token',
	'id_token',
	'code_verifier',
	'client_secret',
]);

/** Redact sensitive query-string values from a URL before it is logged, preserving the path + the
 *  non-sensitive params (which are useful for debugging). Robust to relative URLs. */
export function redactUrl(url: string): string {
	const qIndex = url.indexOf('?');
	if (qIndex === -1) {
		return url;
	}
	const path = url.slice(0, qIndex);
	const params = new URLSearchParams(url.slice(qIndex + 1));
	for (const key of params.keys()) {
		if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
			params.set(key, '***');
		}
	}
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

export class HttpMiddleware {
	/**
	 * Per-route fixed-window rate limit, keyed by the real connection IP (req.ip /
	 * socket address) rather than the spoofable X-Forwarded-For header, so an
	 * attacker cannot bypass the limit by rotating that header.
	 */
	public rateLimit(options: RateLimitOptions) {
		const limiter = new RateLimiter(options);
		return (req: Request, res: Response, next: NextFunction) => {
			const key = req.ip || req.socket?.remoteAddress || 'unknown';
			const { allowed, retryAfterMs } = limiter.check(key, Date.now());
			if (!allowed) {
				res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
				log.warn('http.rate_limited', { path: req.path, ip: getClientIp(req) });
				res.status(429).json({
					error: 'too_many_requests',
					error_description: 'Rate limit exceeded. Try again later.',
				});
				return;
			}
			next();
		};
	}

	public errorHandler() {
		return (error: Error, req: Request, res: Response, next: NextFunction) => {
			log.error('http.error', {
				error: error.message,
				stack: error.stack,
				path: req.path,
				method: req.method,
			});
			if (res.headersSent) {
				return next(error);
			}
			res.status(500).json({
				error: 'server_error',
				error_description: 'Internal server error',
			});
		};
	}

	public correlationId() {
		return (req: Request, res: Response, next: NextFunction) => {
			const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
			log.setCorrelationId(correlationId);
			(req as any).correlationId = correlationId;
			res.setHeader('X-Correlation-ID', correlationId);
			res.on('finish', () => {
				log.clearCorrelationId();
			});
			next();
		};
	}

	public requestLogging() {
		return (req: Request, res: Response, next: NextFunction) => {
			const startTime = Date.now();
			const ip = getClientIp(req);
			const userAgent = req.headers['user-agent'];
			const correlationId = (req as any).correlationId;
			const safeUrl = redactUrl(req.url);
			log.httpRequest(req.method, safeUrl, {
				ip,
				userAgent,
				correlationId,
				contentLength: req.headers['content-length'],
				contentType: req.headers['content-type'],
			});
			res.on('finish', () => {
				const duration = Date.now() - startTime;
				log.httpResponse(req.method, safeUrl, res.statusCode, duration, {
					ip,
					correlationId,
					contentLength: res.getHeader('content-length'),
					contentType: res.getHeader('content-type'),
				});
			});
			next();
		};
	}
}
