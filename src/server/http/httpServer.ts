import * as http from 'http';
import { Socket } from 'node:net';

import express from 'express';

import { AuthProviderType } from '../../creatio/';
import log from '../../log';
import { SessionContext } from '../../sessions';
import { env } from '../../utils';
import { OAuthServer } from '../oauth';

import { CreatioOAuthHandlers } from './creatio-oauth-handlers';
import { McpHandlers } from './mcp-handlers';
import { MCPOAuthHandlers } from './mcp-oauth-handlers';
import { HttpMiddleware } from './middleware';

import type { Server } from '../mcp';

export class HttpServer {
	private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
	// Generous, configurable cap so large CRM payloads/filters are not truncated.
	// DoS on the OAuth surface is handled by the rate limiter (frequency), not body size.
	private static readonly BODY_LIMIT = env('MCP_MAX_BODY_SIZE') || '10mb';
	// Per-route fixed-window limits (per client IP) for the unauthenticated OAuth surface.
	private static readonly RATE_LIMIT_AUTH_FLOW = { windowMs: 60_000, max: 60 };
	private static readonly RATE_LIMIT_TOKEN = { windowMs: 60_000, max: 30 };
	private static readonly RATE_LIMIT_REGISTER = { windowMs: 60_000, max: 10 };
	private static readonly RATE_LIMIT_REVOKE = { windowMs: 60_000, max: 20 };
	private readonly _server: Server;
	private readonly _app = express();
	private readonly _connections = new Set<Socket>();
	private _srv!: http.Server;
	private _cleanupTimer: NodeJS.Timeout | undefined;
	private readonly _sessionContext = SessionContext.instance;
	private readonly _oauthServer: OAuthServer;
	private readonly _middleware: HttpMiddleware;
	private readonly _mcpHandlers: McpHandlers;
	private readonly _creatioOauthHandlers: CreatioOAuthHandlers;
	private readonly _mcpOauthHandlers: MCPOAuthHandlers;

	public get app(): express.Express {
		return this._app;
	}

	constructor(server: Server) {
		this._server = server;
		this._oauthServer = new OAuthServer();
		this._middleware = new HttpMiddleware(this._oauthServer);
		this._mcpHandlers = new McpHandlers(this._server);
		this._creatioOauthHandlers = new CreatioOAuthHandlers(this._server, this._oauthServer);
		this._mcpOauthHandlers = new MCPOAuthHandlers(this._oauthServer);
		this._setupMiddleware();
		this._setupRoutes();
	}

	private _setupMiddleware(): void {
		this._app.use(this._middleware.correlationId());
		this._app.use(this._middleware.requestLogging());
		this._app.use(express.json({ limit: HttpServer.BODY_LIMIT }));
		this._app.use(express.urlencoded({ extended: true, limit: HttpServer.BODY_LIMIT }));
		if (this._isNeedMCPOAuth()) {
			this._app.use('/mcp', this._middleware.bearerAuth());
		}
		this._app.use(this._middleware.errorHandler());
	}

	private _setupRoutes(): void {
		this._setupMCPEndpoints();
		if (this._isNeedMCPOAuth()) {
			this._setupCreatioOAuthEndpoints();
			this._setupMCPOAuthEndpoints();
		}
	}

	private _setupMCPEndpoints(): void {
		this._app.post('/mcp', (req, res) => this._mcpHandlers.handleMcpPost(req, res));
		this._app.get('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
		this._app.delete('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
	}

	private _isNeedMCPOAuth(): boolean {
		return this._server.authProvider.type === AuthProviderType.OAuth2Code;
	}

	private _setupCreatioOAuthEndpoints(): void {
		this._app.get(
			'/oauth/start',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_AUTH_FLOW),
			(req, res) => this._creatioOauthHandlers.handleOAuthStart(req, res),
		);
		this._app.get(
			'/oauth/callback',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_AUTH_FLOW),
			(req, res) => this._creatioOauthHandlers.handleOAuthCallback(req, res),
		);
		this._app.post(
			'/oauth/revoke',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_REVOKE),
			this._middleware.bearerAuth(),
			(req, res) => this._creatioOauthHandlers.handleOAuthRevoke(req, res),
		);
	}

	private _setupMCPOAuthEndpoints(): void {
		this._app.get('/.well-known/oauth-authorization-server', (req, res) =>
			this._mcpOauthHandlers.handleMetadata(req, res),
		);
		this._app.post(
			'/register',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_REGISTER),
			(req, res) => this._mcpOauthHandlers.handleClientRegistration(req, res),
		);
		this._app.get(
			'/authorize',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_AUTH_FLOW),
			(req, res) => this._mcpOauthHandlers.handleAuthorization(req, res),
		);
		this._app.post(
			'/token',
			this._middleware.rateLimit(HttpServer.RATE_LIMIT_TOKEN),
			(req, res) => this._mcpOauthHandlers.handleTokenExchange(req, res),
		);
	}

	public start(port: number) {
		return new Promise<void>((resolve, reject) => {
			this._srv = this._app.listen(port, () => {
				log.httpStart(port);
				resolve();
			});
			this._srv.keepAliveTimeout = 5000;
			this._srv.headersTimeout = Math.max(this._srv.keepAliveTimeout + 1000, 6000);
			this._srv.on('error', (err) => {
				log.error('http.start.error', { error: String(err), port });
				reject(err);
			});
			this._srv.on('connection', (socket: Socket) => {
				this._connections.add(socket);
				socket.once('close', () => this._connections.delete(socket));
			});
			// Periodically evict expired OAuth codes/states and unreachable user tokens so
			// these maps stay bounded over a long-running process. Unref'd so it never holds
			// the event loop open.
			this._cleanupTimer = setInterval(() => {
				this._oauthServer.cleanup();
				this._sessionContext.cleanupExpiredOAuthStates();
				this._sessionContext.evictStaleTokens();
			}, HttpServer.CLEANUP_INTERVAL_MS);
			this._cleanupTimer.unref();
		});
	}

	public async stop() {
		if (this._cleanupTimer) {
			clearInterval(this._cleanupTimer);
			this._cleanupTimer = undefined;
		}
		try {
			this._server.authProvider.cancelAllRefresh();
		} catch (err) {
			log.warn('token_refresh_cleanup_failed', { error: String(err) });
		}
		if (this._srv) {
			try {
				await this._server.stopMcp();
				await new Promise<void>((resolve) => {
					this._srv.close(() => resolve());
				});
			} catch (err) {
				log.error('http.stop.error', { error: String(err) });
			}
		}
		for (const socket of Array.from(this._connections)) {
			try {
				socket.destroy();
			} catch {}
		}
		this._connections.clear();
		const sessions = this._sessionContext.getAllSessions();
		for (const session of sessions) {
			try {
				session.transport?.close();
			} catch (err) {
				log.warn('transport.close.failed', { sessionId: session.id, error: String(err) });
			}
			this._sessionContext.deleteSession(session.id);
		}
	}
}
