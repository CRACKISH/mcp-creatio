import { randomUUID } from 'crypto';

import log from '../../log';
import { getClientIp } from '../../utils';

import { RateLimiter } from './rate-limiter';

import type { RateLimitOptions } from './rate-limiter';
import type { OAuthServer } from '../oauth';
import type { NextFunction, Request, Response } from 'express';

export class HttpMiddleware {
	private readonly _oauthServer: OAuthServer;

	constructor(oauthServer: OAuthServer) {
		this._oauthServer = oauthServer;
	}

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

	public bearerAuth() {
		return (req: Request, res: Response, next: NextFunction) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.slice(7);
				const userKey = this._oauthServer.validateAccessToken(token);
				if (userKey) {
					(req as any).userKey = userKey;
					return next();
				}
			}
			res.status(401).json({
				error: 'unauthorized',
				error_description:
					'Valid Bearer token required. Use OAuth 2.1 flow to obtain access token.',
			});
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
			log.httpRequest(req.method, req.url, {
				ip,
				userAgent,
				correlationId,
				contentLength: req.headers['content-length'],
				contentType: req.headers['content-type'],
			});
			res.on('finish', () => {
				const duration = Date.now() - startTime;
				log.httpResponse(req.method, req.url, res.statusCode, duration, {
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
