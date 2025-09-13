import * as http from 'http';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';

import log from '../../log';
import { getClientIp } from '../../utils/network';
import { Server } from '../mcp';

function getSessionId(req: any) {
	return (
		req.headers['mcp-session-id'] ||
		req.query?.session_id ||
		req.headers['x-session-id'] ||
		req.body?.params?.session_id ||
		req.body?.session_id ||
		null
	);
}

export class HttpServer {
	private readonly _app = express();
	private readonly _transports: Record<string, StreamableHTTPServerTransport> = {};
	private readonly _loggedSessions = new Set<string>();
	private readonly _connections = new Set<Socket>();
	private _srv!: http.Server;

	constructor(private readonly _server: Server) {
		this._app.use(express.json());

		this._app.post('/mcp', async (req, res) => {
			const sessionId = getSessionId(req);
			let transport: StreamableHTTPServerTransport | undefined;

			const remoteIp = getClientIp(req);
			if (sessionId && this._transports[sessionId]) {
				transport = this._transports[sessionId];
				if (!this._loggedSessions.has(sessionId)) {
					this._loggedSessions.add(sessionId);
					log.sessionConnect(sessionId, String(remoteIp));
				}
			} else if (!sessionId && isInitializeRequest(req.body)) {
				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => randomUUID(),
					onsessioninitialized: (sid) => {
						if (transport) {
							this._transports[sid] = transport;
							if (!this._loggedSessions.has(sid)) {
								this._loggedSessions.add(sid);
								log.sessionConnect(sid, String(remoteIp));
							}
						}
					},
				});

				transport.onclose = () => {
					if (transport?.sessionId) {
						log.sessionDisconnect(transport.sessionId, String(remoteIp));
						this._loggedSessions.delete(transport.sessionId);
						delete this._transports[transport.sessionId];
					}
				};

				const mcp = await this._server.startMcp();
				await mcp.connect(transport);
			} else {
				res.status(400).json({
					jsonrpc: '2.0',
					error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
					id: null,
				});
				return;
			}

			await transport!.handleRequest(req, res, req.body);
		});

		const handleSessionRequest = async (req: express.Request, res: express.Response) => {
			const sessionId = req.headers['mcp-session-id'] as string | undefined;
			if (!sessionId || !this._transports[sessionId]) {
				res.status(400).send('Invalid or missing session ID');
				return;
			}
			const transport = this._transports[sessionId];
			await transport.handleRequest(req, res);
		};

		this._app.get('/mcp', handleSessionRequest);
		this._app.delete('/mcp', handleSessionRequest);
	}

	public start(port: number) {
		return new Promise<void>((resolve, reject) => {
			this._srv = this._app.listen(port, () => {
				log.httpStart(port);
				resolve();
			});
			// Tighten timeouts so keep-alive sockets don't delay shutdown
			this._srv.keepAliveTimeout = 5000; // 5s
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
		for (const sid of Object.keys(this._transports)) {
			try {
				const t = this._transports[sid];
				t?.close();
			} catch (err) {
				log.warn('transport.close.failed', { sessionId: sid, error: String(err) });
			}
			delete this._transports[sid];
			this._loggedSessions.delete(sid);
		}
	}
}
