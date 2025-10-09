import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import log from '../../log';
import { SessionContext } from '../../services';
import {
	getClientIp,
	getSessionIdFromRequest,
	getUserKeyFromRequest,
	runWithContext,
} from '../../utils';

import type { Server } from '../mcp';
import type { Request, Response } from 'express';

export class McpHandlers {
	private readonly _sessionContext = SessionContext.instance;

	constructor(private readonly _server: Server) {}

	public async handleMcpPost(req: Request, res: Response): Promise<void> {
		const sessionId = getSessionIdFromRequest(req);
		const bearerUserKey = (req as any).userKey;
		let transport: StreamableHTTPServerTransport | undefined;
		const remoteIp = getClientIp(req);
		if (sessionId && this._sessionContext.hasSession(sessionId)) {
			const session = this._sessionContext.getSession(sessionId);
			transport = session?.transport;
			if (session && !session.isLogged) {
				this._sessionContext.markSessionAsLogged(sessionId);
				log.sessionConnect(sessionId, String(remoteIp));
			}
		} else if (!sessionId && isInitializeRequest(req.body)) {
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (sid) => {
					if (transport) {
						const session = this._sessionContext.createSession(
							sid,
							bearerUserKey,
							remoteIp,
						);
						this._sessionContext.setSessionTransport(sid, transport);
						this._sessionContext.markSessionAsLogged(sid);
						log.sessionConnect(sid, String(remoteIp));
					}
				},
			});
			transport.onclose = () => {
				if (transport?.sessionId) {
					log.sessionDisconnect(transport.sessionId, String(remoteIp));
					this._sessionContext.deleteSession(transport.sessionId);
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
		const session = this._sessionContext.getSession(sessionId);
		const userKey = bearerUserKey || session?.userKey;
		await runWithContext({ userKey, sessionId }, async () =>
			transport!.handleRequest(req, res, req.body),
		);
	}

	public async handleSessionRequest(req: Request, res: Response): Promise<void> {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		if (!sessionId || !this._sessionContext.hasSession(sessionId)) {
			res.status(400).send('Invalid or missing session ID');
			return;
		}
		const session = this._sessionContext.getSession(sessionId);
		const transport = session?.transport;
		if (!transport) {
			res.status(400).send('Session has no transport');
			return;
		}
		const userKey = getUserKeyFromRequest(req as any);
		await runWithContext({ userKey, sessionId }, async () => transport.handleRequest(req, res));
	}
}
