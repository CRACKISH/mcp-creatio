import * as http from 'http';
import { Socket } from 'node:net';

import express from 'express';

import { AuthProviderType } from '../../creatio/';
import log from '../../log';
import { SessionContext } from '../../services';
import { OAuthServer } from '../oauth';

import { CreatioOAuthHandlers } from './creatio-oauth-handlers';
import { McpHandlers } from './mcp-handlers';
import { MCPOAuthHandlers } from './mcp-oauth-handlers';
import { HttpMiddleware } from './middleware';

import type { Server } from '../mcp';

export class HttpServer {
	private readonly _app = express();
	private readonly _connections = new Set<Socket>();
	private _srv!: http.Server;
	private readonly _sessionContext = SessionContext.instance;
	private readonly _oauthServer: OAuthServer;
	private readonly _middleware: HttpMiddleware;
	private readonly _mcpHandlers: McpHandlers;
	private readonly _creatioOauthHandlers: CreatioOAuthHandlers;
	private readonly _mcpOauthHandlers: MCPOAuthHandlers;

	constructor(private readonly _server: Server) {
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
		this._app.use(express.json());
		this._app.use(express.urlencoded({ extended: true }));
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
		this._app.get('/oauth/start', (req, res) =>
			this._creatioOauthHandlers.handleOAuthStart(req, res),
		);
		this._app.get('/oauth/callback', (req, res) =>
			this._creatioOauthHandlers.handleOAuthCallback(req, res),
		);
		this._app.post('/oauth/revoke', (req, res) =>
			this._creatioOauthHandlers.handleOAuthRevoke(req, res),
		);
	}

	private _setupMCPOAuthEndpoints(): void {
		this._app.get('/.well-known/oauth-authorization-server', (req, res) =>
			this._mcpOauthHandlers.handleMetadata(req, res),
		);
		this._app.post('/register', (req, res) =>
			this._mcpOauthHandlers.handleClientRegistration(req, res),
		);
		this._app.get('/authorize', (req, res) =>
			this._mcpOauthHandlers.handleAuthorization(req, res),
		);
		this._app.post('/token', (req, res) =>
			this._mcpOauthHandlers.handleTokenExchange(req, res),
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
		});
	}

	public async stop() {
		try {
			if (this._server.authProvider && 'cancelAllRefresh' in this._server.authProvider) {
				(this._server.authProvider as any).cancelAllRefresh();
			}
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
