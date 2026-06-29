import * as http from 'http';
import { Socket } from 'node:net';

import express from 'express';

import log from '../../log';
import { SessionContext } from '../../sessions';

import { AuthEdge, createAuthEdge } from './auth-edge';
import { HealthEndpoints } from './health';
import { McpHandlers } from './mcp-handlers';
import { HttpMiddleware } from './middleware';

import type { CreatioClientConfig } from '../../creatio/';
import type { Server } from '../mcp';

export class HttpServer {
	private static readonly BODY_LIMIT = '10mb';
	private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
	private readonly _server: Server;
	private readonly _app = express();
	private readonly _connections = new Set<Socket>();
	private _srv!: http.Server;
	private _cleanupTimer: NodeJS.Timeout | undefined;
	private readonly _sessionContext = SessionContext.instance;
	private readonly _middleware = new HttpMiddleware();
	private readonly _health = new HealthEndpoints();
	private readonly _mcpHandlers: McpHandlers;
	private readonly _authEdge: AuthEdge | undefined;

	public get app(): express.Express {
		return this._app;
	}

	constructor(server: Server, config?: CreatioClientConfig) {
		this._server = server;
		this._mcpHandlers = new McpHandlers(this._server);
		this._authEdge = createAuthEdge(config, this._sessionContext);
		// Health probes are registered first so they sit ahead of the auth + request-logging
		// middleware: probes stay unauthenticated and never spam the request log at probe cadence.
		this._health.register(this._app);
		this._setupMiddleware();
		this._setupRoutes();
	}

	private _setupMiddleware(): void {
		this._app.use(this._middleware.correlationId());
		this._app.use(this._middleware.requestLogging());
		this._app.use(express.json({ limit: HttpServer.BODY_LIMIT }));
		this._app.use(express.urlencoded({ extended: true, limit: HttpServer.BODY_LIMIT }));
		// Guard /mcp with the configured auth strategy (delegated/gateway bearer, or the broker's
		// own issued token); no edge means a single-identity config with nothing to authenticate.
		if (this._authEdge) {
			this._app.use('/mcp', this._authEdge.mcpAuth());
		}
		this._app.use(this._middleware.errorHandler());
	}

	private _setupRoutes(): void {
		this._setupMCPEndpoints();
		this._authEdge?.registerRoutes(this._app, (o) => this._middleware.rateLimit(o));
	}

	private _setupMCPEndpoints(): void {
		this._app.post('/mcp', (req, res) => this._mcpHandlers.handleMcpPost(req, res));
		this._app.get('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
		this._app.delete('/mcp', (req, res) => this._mcpHandlers.handleSessionRequest(req, res));
	}

	public start(port: number) {
		return new Promise<void>((resolve, reject) => {
			this._srv = this._app.listen(port, () => {
				this._health.setReady(true);
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
			// Some edges (broker) keep transient state to evict periodically so the maps stay
			// bounded. Unref'd so it never holds the loop open.
			if (this._authEdge?.cleanup) {
				this._cleanupTimer = setInterval(
					() => this._authEdge!.cleanup!(),
					HttpServer.CLEANUP_INTERVAL_MS,
				);
				this._cleanupTimer.unref();
			}
		});
	}

	public async stop() {
		// Fail readiness immediately so the orchestrator drains traffic from this pod before we
		// start closing connections below.
		this._health.setReady(false);
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
