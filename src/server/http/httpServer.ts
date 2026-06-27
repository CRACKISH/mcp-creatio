import * as http from 'http';
import { Socket } from 'node:net';

import express from 'express';

import { AuthProviderType, CreatioOAuthClient } from '../../creatio/';
import log from '../../log';
import { SessionContext } from '../../sessions';
import { BearerEdge } from '../bearer';
import { OAuthServer } from '../oauth';

import { BrokerHandlers } from './broker-handlers';
import { McpHandlers } from './mcp-handlers';
import { HttpMiddleware } from './middleware';

import type { BearerAuthConfig, BrokerAuthConfig, CreatioClientConfig } from '../../creatio/';
import type { Server } from '../mcp';

export class HttpServer {
	private static readonly BODY_LIMIT = '10mb';
	private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
	// Per-route fixed-window limits (per IP) for the unauthenticated broker OAuth surface.
	private static readonly RATE_LIMIT_AUTH_FLOW = { windowMs: 60_000, max: 60 };
	private static readonly RATE_LIMIT_TOKEN = { windowMs: 60_000, max: 30 };
	private static readonly RATE_LIMIT_REGISTER = { windowMs: 60_000, max: 10 };
	private readonly _server: Server;
	private readonly _app = express();
	private readonly _connections = new Set<Socket>();
	private _srv!: http.Server;
	private _cleanupTimer: NodeJS.Timeout | undefined;
	private readonly _sessionContext = SessionContext.instance;
	private readonly _middleware = new HttpMiddleware();
	private readonly _mcpHandlers: McpHandlers;
	private readonly _bearerEdge: BearerEdge | undefined;
	private readonly _broker: BrokerHandlers | undefined;
	private readonly _brokerOAuth: OAuthServer | undefined;

	public get app(): express.Express {
		return this._app;
	}

	constructor(server: Server, config?: CreatioClientConfig) {
		this._server = server;
		this._mcpHandlers = new McpHandlers(this._server);
		const auth = config?.auth;
		if (auth?.kind === AuthProviderType.OAuth2Bearer) {
			this._bearerEdge = new BearerEdge(auth as BearerAuthConfig, config!.baseUrl);
		} else if (auth?.kind === AuthProviderType.Broker) {
			const brokerAuth = auth as BrokerAuthConfig;
			this._brokerOAuth = new OAuthServer(brokerAuth.jwtSecret);
			this._broker = new BrokerHandlers(
				this._brokerOAuth,
				new CreatioOAuthClient(config!.baseUrl, brokerAuth),
				this._sessionContext,
			);
		}
		this._setupMiddleware();
		this._setupRoutes();
	}

	private _setupMiddleware(): void {
		this._app.use(this._middleware.correlationId());
		this._app.use(this._middleware.requestLogging());
		this._app.use(express.json({ limit: HttpServer.BODY_LIMIT }));
		this._app.use(express.urlencoded({ extended: true, limit: HttpServer.BODY_LIMIT }));
		if (this._bearerEdge) {
			// Stateless per-request auth: every /mcp call must carry a Creatio access token.
			this._app.use('/mcp', this._bearerEdge.mcpAuth());
		} else if (this._broker) {
			// Broker mode: /mcp requires a token THIS server issued.
			this._app.use('/mcp', this._broker.mcpAuth());
		}
		this._app.use(this._middleware.errorHandler());
	}

	private _setupRoutes(): void {
		this._setupMCPEndpoints();
		if (this._bearerEdge) {
			this._bearerEdge.registerRoutes(this._app);
		} else if (this._broker) {
			this._setupBrokerEndpoints(this._broker);
		}
	}

	private _setupMCPEndpoints(): void {
		this._app.post('/mcp', (req, res) => this._mcpHandlers.handleMcpPost(req, res));
		this._app.get('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
		this._app.delete('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
	}

	private _setupBrokerEndpoints(broker: BrokerHandlers): void {
		const rl = (o: { windowMs: number; max: number }) => this._middleware.rateLimit(o);
		this._app.get('/.well-known/oauth-authorization-server', (q, s) =>
			broker.handleMetadata(q, s),
		);
		this._app.get('/.well-known/oauth-protected-resource', (q, s) =>
			broker.handleProtectedResourceMetadata(q, s),
		);
		this._app.post('/register', rl(HttpServer.RATE_LIMIT_REGISTER), (q, s) =>
			broker.handleRegister(q, s),
		);
		this._app.get('/authorize', rl(HttpServer.RATE_LIMIT_AUTH_FLOW), (q, s) =>
			broker.handleAuthorize(q, s),
		);
		this._app.get('/oauth/callback', rl(HttpServer.RATE_LIMIT_AUTH_FLOW), (q, s) =>
			broker.handleCallback(q, s),
		);
		this._app.post('/token', rl(HttpServer.RATE_LIMIT_TOKEN), (q, s) =>
			broker.handleToken(q, s),
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
			// Broker mode keeps transient state (codes, pending auths, user tokens) — evict expired
			// entries periodically so the maps stay bounded. Unref'd so it never holds the loop open.
			if (this._brokerOAuth) {
				this._cleanupTimer = setInterval(() => {
					this._brokerOAuth!.cleanup();
					this._sessionContext.evictStaleTokens();
				}, HttpServer.CLEANUP_INTERVAL_MS);
				this._cleanupTimer.unref();
			}
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
				await this._server.stopAll();
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
