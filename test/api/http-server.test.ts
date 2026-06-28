import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType, CreatioEngineManager } from '../../src/creatio';
import { HttpServer } from '../../src/server/http/http-server';
import { Server } from '../../src/server/mcp';
import { SessionContext } from '../../src/sessions/session-context';
import { makeFakeContext } from '../support/fake-context';
import { createTestServer, resetSessionContext } from '../support/test-server';

import type { Express } from 'express';

function buildRealHttp(authType: AuthProviderType = AuthProviderType.Legacy) {
	const context = makeFakeContext(authType);
	const engines = new CreatioEngineManager(context as never);
	const server = new Server(engines, {});
	const http = new HttpServer(server);
	return { http, app: http.app };
}

describe('HttpServer lifecycle', () => {
	it('starts on an ephemeral port and stops cleanly', async () => {
		resetSessionContext();
		const { httpServer } = createTestServer();
		await httpServer.start(0);
		await httpServer.stop();
	});
});

describe('McpHandlers error branches', () => {
	let app: Express;

	beforeEach(() => {
		resetSessionContext();
		app = buildRealHttp().app;
	});

	it('returns 400 on POST /mcp without a session for a non-initialize request', async () => {
		const res = await request(app)
			.post('/mcp')
			.set('content-type', 'application/json')
			.send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
		expect(res.status).toBe(400);
	});

	it('returns 400 on GET /mcp without a session id', async () => {
		const res = await request(app).get('/mcp');
		expect(res.status).toBe(400);
	});

	it('returns 400 when the session exists but has no transport', async () => {
		SessionContext.instance.createSession('s-no-transport');
		const res = await request(app).get('/mcp').set('mcp-session-id', 's-no-transport');
		expect(res.status).toBe(400);
	});

	it('routes GET /mcp to an existing session transport', async () => {
		const handleRequest = vi.fn(
			async (_req: unknown, res: { status: (n: number) => { end: () => void } }) => {
				res.status(200).end();
			},
		);
		SessionContext.instance.createSession('s-live', 'u1');
		SessionContext.instance.setSessionTransport('s-live', { handleRequest } as never);
		const res = await request(app).get('/mcp').set('mcp-session-id', 's-live');
		expect(res.status).toBe(200);
		expect(handleRequest).toHaveBeenCalled();
	});

	it('initializes a brand-new MCP session over POST /mcp', async () => {
		const res = await request(app)
			.post('/mcp')
			.set('content-type', 'application/json')
			.set('Accept', 'application/json, text/event-stream')
			.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test-client', version: '1.0.0' },
				},
			});
		expect(res.status).toBe(200);
		expect(res.headers['mcp-session-id']).toBeTruthy();
	});

	it('routes POST /mcp with an existing session id to its transport', async () => {
		const handleRequest = vi.fn(
			async (_req: unknown, res: { status: (n: number) => { end: () => void } }) => {
				res.status(200).end();
			},
		);
		SessionContext.instance.createSession('s-post', 'u1');
		SessionContext.instance.setSessionTransport('s-post', { handleRequest } as never);
		const res = await request(app)
			.post('/mcp')
			.set('mcp-session-id', 's-post')
			.set('content-type', 'application/json')
			.send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
		expect(res.status).toBe(200);
		expect(handleRequest).toHaveBeenCalled();
	});
});
