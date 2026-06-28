import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import log from '../../log';
import { SessionContext } from '../../sessions';
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
	private readonly _server: Server;

	constructor(server: Server) {
		this._server = server;
	}

	public async handleMcpPost(req: Request, res: Response): Promise<void> {
		const sessionId = getSessionIdFromRequest(req);
		const bearerUserKey = (req as any).userKey;
		// Gateway multi-tenant routing key — selects which tenant the session server and capability
		// probe bind to (absent in single-tenant modes ⇒ the default tenant).
		const baseUrlOverride = (req as any).baseUrlOverride as string | undefined;
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
			// Each session gets its own McpServer (a single McpServer connects to one transport
			// only), bound to the request's tenant. Release it when the transport closes so we
			// don't leak servers or register late-probed tools into dead sessions.
			const mcp = this._server.createSessionServer(baseUrlOverride);
			transport.onclose = () => {
				this._server.releaseSessionServer(mcp);
				if (transport?.sessionId) {
					log.sessionDisconnect(transport.sessionId, String(remoteIp));
					this._sessionContext.deleteSession(transport.sessionId);
				}
			};
			await mcp.connect(transport as any);
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
		const bearerToken = (req as any).bearerToken as string | undefined;
		await runWithContext({ userKey, sessionId, bearerToken, baseUrlOverride }, async () => {
			// Kick the per-tenant capability probe from inside the request context so its Creatio
			// calls carry this caller's identity (broker mode has no user otherwise). Non-blocking.
			this._server.ensureCapabilitiesProbed(baseUrlOverride);
			return transport!.handleRequest(req, res, req.body);
		});
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
		// Prefer the validated Bearer identity and the session's own mapping over any
		// caller-supplied ?userKey=/x-user-key, which must not override an authenticated
		// identity (CWE-639).
		const userKey =
			(req as any).userKey || session?.userKey || getUserKeyFromRequest(req as any);
		const bearerToken = (req as any).bearerToken as string | undefined;
		const baseUrlOverride = (req as any).baseUrlOverride as string | undefined;
		await runWithContext({ userKey, sessionId, bearerToken, baseUrlOverride }, async () =>
			transport.handleRequest(req, res),
		);
	}
}
