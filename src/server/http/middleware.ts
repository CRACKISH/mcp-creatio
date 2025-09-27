import { randomUUID } from 'crypto';

import log from '../../log';
import { getClientIp } from '../../utils';

import type { OAuthServer } from '../oauth';
import type { NextFunction, Request, Response } from 'express';

/**
 * Express middleware collection for HTTP server
 */
export class HttpMiddleware {
	constructor(private readonly _oauthServer: OAuthServer) {}

	/**
	 * Bearer token authentication middleware for MCP requests
	 */
	public bearerAuth() {
		return (req: Request, res: Response, next: NextFunction) => {
			const authHeader = req.headers.authorization;
			if (authHeader && authHeader.startsWith('Bearer ')) {
				const token = authHeader.slice(7);
				const userKey = this._oauthServer.validateAccessToken(token);
				if (userKey) {
					// Set userKey in context for downstream handlers
					(req as any).userKey = userKey;
					return next();
				}
			}

			// No valid Bearer token - return 401 with OAuth error
			res.status(401).json({
				error: 'unauthorized',
				error_description:
					'Valid Bearer token required. Use OAuth 2.1 flow to obtain access token.',
			});
		};
	}

	/**
	 * Error handling middleware
	 */
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

	/**
	 * Correlation ID middleware - generates and tracks request correlation ID
	 */
	public correlationId() {
		return (req: Request, res: Response, next: NextFunction) => {
			const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();

			// Set correlation ID in log context
			log.setCorrelationId(correlationId);

			// Add to request for other middleware/handlers
			(req as any).correlationId = correlationId;

			// Add to response headers
			res.setHeader('X-Correlation-ID', correlationId);

			// Clear correlation ID after request
			res.on('finish', () => {
				log.clearCorrelationId();
			});

			next();
		};
	}

	/**
	 * HTTP request/response logging middleware
	 */
	public requestLogging() {
		return (req: Request, res: Response, next: NextFunction) => {
			const startTime = Date.now();
			const ip = getClientIp(req);
			const userAgent = req.headers['user-agent'];
			const correlationId = (req as any).correlationId;

			// Log incoming request
			log.httpRequest(req.method, req.url, {
				ip,
				userAgent,
				correlationId,
				contentLength: req.headers['content-length'],
				contentType: req.headers['content-type'],
			});

			// Log response when request finishes
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
