import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthProviderType, CreatioEngineManager } from '../../src/creatio';
import { HttpServer } from '../../src/server/http/httpServer';
import { Server } from '../../src/server/mcp';
import { SessionContext } from '../../src/services/session-context';
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
});
