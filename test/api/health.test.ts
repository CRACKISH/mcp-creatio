import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { VERSION } from '../../src/version';
import { createTestServer, resetSessionContext } from '../support/test-server';

describe('Health endpoints', () => {
	beforeEach(() => {
		resetSessionContext();
	});

	it('GET /healthz reports liveness without auth', async () => {
		const { app } = createTestServer();
		const res = await request(app).get('/healthz');
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('ok');
		expect(res.body.version).toBe(VERSION);
		expect(typeof res.body.uptimeSec).toBe('number');
	});

	it('GET /readyz is 503 before the server starts listening', async () => {
		const { app } = createTestServer();
		const res = await request(app).get('/readyz');
		expect(res.status).toBe(503);
		expect(res.body.status).toBe('starting');
	});

	it('GET /readyz flips to 200 once listening and back to 503 after stop', async () => {
		const { httpServer, app } = createTestServer();
		await httpServer.start(0);
		try {
			const ready = await request(app).get('/readyz');
			expect(ready.status).toBe(200);
			expect(ready.body.status).toBe('ready');
		} finally {
			await httpServer.stop();
		}
		const drained = await request(app).get('/readyz');
		expect(drained.status).toBe(503);
	});
});
