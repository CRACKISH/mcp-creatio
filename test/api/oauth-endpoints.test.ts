import crypto from 'crypto';

import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestServer, resetSessionContext } from '../support/test-server';

import type { AuthProviderMock } from '../support/test-server';
import type { SessionContext } from '../../src/services/session-context';
import type { Express } from 'express';

describe('OAuth endpoints — security regressions (Batch B)', () => {
	let app: Express;
	let authProvider: AuthProviderMock;
	let sessionContext: SessionContext;

	beforeEach(() => {
		resetSessionContext();
		const t = createTestServer();
		app = t.app;
		authProvider = t.authProvider;
		sessionContext = t.sessionContext;
	});

	// C4 — revoke must require a Bearer token; ?userKey= must not be honored.
	it('rejects /oauth/revoke without a Bearer token (C4)', async () => {
		const res = await request(app).post('/oauth/revoke').query({ userKey: 'victim' });
		expect(res.status).toBe(401);
		expect(authProvider.revokeUserKeys).toHaveLength(0);
	});

	it('rejects /oauth/revoke with an invalid Bearer token (C4)', async () => {
		const res = await request(app)
			.post('/oauth/revoke')
			.set('Authorization', 'Bearer not-a-jwt')
			.query({ userKey: 'victim' });
		expect(res.status).toBe(401);
		expect(authProvider.revokeUserKeys).toHaveLength(0);
	});

	// H3 — state is mandatory on /authorize.
	it('rejects /authorize without state (H3)', async () => {
		const res = await request(app).get('/authorize').query({
			client_id: 'client-1',
			redirect_uri: 'http://localhost:1/cb',
			response_type: 'code',
			code_challenge: 'abc',
			code_challenge_method: 'S256',
		});
		expect(res.status).toBe(302);
		const loc = new URL(res.headers.location);
		expect(loc.searchParams.get('error')).toBe('invalid_request');
		expect(loc.searchParams.get('error_description')).toMatch(/state/);
	});

	// H2 — never redirect to a non-allowlisted redirect_uri.
	it('rejects /authorize with a remote redirect_uri without redirecting (H2)', async () => {
		const res = await request(app).get('/authorize').query({
			client_id: 'client-1',
			redirect_uri: 'https://evil.example.com/cb',
			response_type: 'code',
			state: 'mcp-state',
			code_challenge: 'abc',
			code_challenge_method: 'S256',
		});
		expect(res.status).toBe(400);
		expect(res.headers.location).toBeUndefined();
	});

	it('rejects /register with a disallowed redirect_uri (H2)', async () => {
		const res = await request(app)
			.post('/register')
			.send({ redirect_uris: ['https://evil.example.com/cb'] });
		expect(res.status).toBe(400);
	});

	// H4 — /token is rate limited (30/min).
	it('rate-limits /token after the per-minute budget (H4)', async () => {
		let lastStatus = 0;
		for (let i = 0; i < 31; i++) {
			const res = await request(app)
				.post('/token')
				.type('form')
				.send({ grant_type: 'authorization_code' });
			lastStatus = res.status;
		}
		expect(lastStatus).toBe(429);
	});

	// C1 — the callback maps ONLY the initiating session, never every active session.
	it('maps only the initiating session on callback (C1)', async () => {
		sessionContext.createSession('sess-victim');
		sessionContext.createSession('sess-attacker');

		const start = await request(app)
			.get('/oauth/start')
			.query({ userKey: 'victim-user' })
			.set('mcp-session-id', 'sess-victim');
		expect(start.status).toBe(302);

		const creatioState = new URL(start.headers.location).searchParams.get('state');
		expect(creatioState).toBeTruthy();

		const cb = await request(app)
			.get('/oauth/callback')
			.query({ code: 'creatio-code', state: creatioState as string });
		expect(cb.status).toBe(200);

		expect(sessionContext.getSession('sess-victim')?.userKey).toBe('victim-user');
		expect(sessionContext.getSession('sess-attacker')?.userKey).toBeUndefined();
		expect(authProvider.finishCodes).toContain('creatio-code');
	});
});

describe('OAuth endpoint branch coverage', () => {
	let app: Express;

	beforeEach(() => {
		resetSessionContext();
		app = createTestServer().app;
	});

	it('/oauth/start requires a userKey', async () => {
		const res = await request(app).get('/oauth/start');
		expect(res.status).toBe(400);
	});

	it('/oauth/callback requires code and state', async () => {
		const res = await request(app).get('/oauth/callback');
		expect(res.status).toBe(400);
	});

	it('serves the authorization-server metadata', async () => {
		const res = await request(app).get('/.well-known/oauth-authorization-server');
		expect(res.status).toBe(200);
		expect(res.body.token_endpoint).toContain('/token');
	});

	it('/register rejects a non-array redirect_uris', async () => {
		const res = await request(app).post('/register').send({ redirect_uris: 'nope' });
		expect(res.status).toBe(400);
	});
});

describe('OAuth proxy flow — contract test (Batch C)', () => {
	let app: Express;

	beforeEach(() => {
		resetSessionContext();
		app = createTestServer().app;
	});

	it('issues a token through the full PKCE flow and accepts it as Bearer', async () => {
		const verifier = crypto.randomBytes(32).toString('base64url');
		const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
		const redirectUri = 'http://localhost:7777/callback';

		// 1. Dynamic client registration.
		const reg = await request(app)
			.post('/register')
			.send({ redirect_uris: [redirectUri] });
		expect(reg.status).toBe(201);
		const clientId = reg.body.client_id as string;
		expect(clientId).toBeTruthy();

		// 2. Authorize -> redirect into the Creatio start endpoint.
		const authz = await request(app).get('/authorize').query({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			state: 'mcp-state-1',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		});
		expect(authz.status).toBe(302);
		const startPath = authz.headers.location as string;
		expect(startPath).toContain('/oauth/start');

		// 3. Start -> redirect to the (mocked) Creatio identity server.
		const start = await request(app).get(startPath);
		expect(start.status).toBe(302);
		const combinedState = new URL(start.headers.location).searchParams.get('state') as string;
		expect(combinedState).toContain('client_id=');

		// 4. Creatio redirects back -> we mint an MCP authorization code for the client.
		const cb = await request(app)
			.get('/oauth/callback')
			.query({ code: 'creatio-code', state: combinedState });
		expect(cb.status).toBe(302);
		const clientRedirect = new URL(cb.headers.location);
		expect(clientRedirect.origin + clientRedirect.pathname).toBe(redirectUri);
		expect(clientRedirect.searchParams.get('state')).toBe('mcp-state-1');
		const authCode = clientRedirect.searchParams.get('code') as string;
		expect(authCode).toBeTruthy();

		// 5. Exchange the code (with PKCE verifier) for an access token.
		const tok = await request(app).post('/token').type('form').send({
			grant_type: 'authorization_code',
			code: authCode,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: verifier,
		});
		expect(tok.status).toBe(200);
		expect(tok.body.access_token).toBeTruthy();

		// 6. The issued token is accepted by the Bearer-guarded endpoint.
		const rev = await request(app)
			.post('/oauth/revoke')
			.set('Authorization', `Bearer ${tok.body.access_token}`);
		expect(rev.status).toBe(200);
	});

	it('rejects the token exchange when the PKCE verifier is wrong', async () => {
		const challenge = crypto
			.createHash('sha256')
			.update('the-real-verifier')
			.digest('base64url');
		const redirectUri = 'http://localhost:7777/callback';
		const reg = await request(app)
			.post('/register')
			.send({ redirect_uris: [redirectUri] });
		const clientId = reg.body.client_id as string;
		const authz = await request(app).get('/authorize').query({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: 'code',
			state: 'mcp-state-2',
			code_challenge: challenge,
			code_challenge_method: 'S256',
		});
		const start = await request(app).get(authz.headers.location as string);
		const combinedState = new URL(start.headers.location).searchParams.get('state') as string;
		const cb = await request(app)
			.get('/oauth/callback')
			.query({ code: 'creatio-code', state: combinedState });
		const authCode = new URL(cb.headers.location).searchParams.get('code') as string;

		const tok = await request(app).post('/token').type('form').send({
			grant_type: 'authorization_code',
			code: authCode,
			redirect_uri: redirectUri,
			client_id: clientId,
			code_verifier: 'WRONG-verifier',
		});
		expect(tok.status).toBe(400);
		expect(tok.body.error).toBe('invalid_grant');
	});
});
