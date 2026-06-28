import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { HttpServer } from '../../src/server/http/http-server';
import { generatePkcePair } from '../../src/utils';
import { resetSessionContext } from '../support/test-server';

import type { Server } from '../../src/server/mcp';

const CLIENT_REDIRECT = 'http://localhost:7777/cb';

/**
 * Full-stack broker integration: drives the REAL Express app (middleware → rate limiters → auth-edge
 * route wiring → BrokerHandlers → OAuthServer) over HTTP via supertest. The Creatio leg
 * (`/connect/*`) is the only thing faked (global fetch). This is the broker as a continuation of the
 * HTTP server — complementary to the handler-level unit tests in broker-handlers.test.ts.
 */
function brokerApp() {
	const authProvider = {
		type: AuthProviderType.Broker,
		async getHeaders() {
			return {};
		},
		async refresh() {},
		cancelAllRefresh() {},
	};
	const fakeServer = {
		get authProvider() {
			return authProvider;
		},
		createSessionServer() {
			return { connect: async () => {}, close: () => {} };
		},
		ensureCapabilitiesProbed() {},
		releaseSessionServer() {},
		async stopAll() {},
	};
	const config = {
		baseUrl: 'https://t.creatio.local',
		auth: {
			kind: AuthProviderType.Broker,
			clientId: 'creatio-app',
			jwtSecret: 'broker-api-test-secret-0123456789',
		},
	};
	return new HttpServer(fakeServer as unknown as Server, config as never).app;
}

function stubCreatioToken(sub: string) {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						access_token: jwt.sign({ sub }, 'x'),
						refresh_token: 'RT',
						expires_in: 3600,
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
		),
	);
}

beforeEach(() => {
	resetSessionContext();
	// Pin the public origin so the issued token's aud/iss is stable across supertest's
	// per-request ephemeral ports (also exercises the CREATIO_MCP_PUBLIC_URL path).
	vi.stubEnv('CREATIO_MCP_PUBLIC_URL', 'http://mcp.test');
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('broker HTTP API (full stack via supertest)', () => {
	it('discovery advertises refresh + revocation endpoints', async () => {
		const app = brokerApp();
		const md = await request(app).get('/.well-known/oauth-authorization-server');
		expect(md.status).toBe(200);
		expect(md.body.grant_types_supported).toEqual(
			expect.arrayContaining(['authorization_code', 'refresh_token']),
		);
		expect(md.body.revocation_endpoint).toMatch(/\/revoke$/);
		expect(md.body.code_challenge_methods_supported).toContain('S256');
		const prm = await request(app).get('/.well-known/oauth-protected-resource');
		expect(prm.status).toBe(200);
		expect(prm.body.resource).toMatch(/\/mcp$/);
	});

	it('guards POST /mcp without a token (401 + WWW-Authenticate)', async () => {
		const res = await request(brokerApp())
			.post('/mcp')
			.set('Accept', 'application/json, text/event-stream')
			.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
		expect(res.status).toBe(401);
		expect(res.headers['www-authenticate']).toContain('resource_metadata=');
	});

	it('rejects authorize with a disallowed redirect_uri (400)', async () => {
		const res = await request(brokerApp()).get('/authorize').query({
			client_id: 'x',
			redirect_uri: 'https://evil.example.com/cb',
			response_type: 'code',
			code_challenge: 'c',
			code_challenge_method: 'S256',
		});
		expect(res.status).toBe(400);
	});

	it('register → authorize → callback → token → revoke, end to end over HTTP', async () => {
		const app = brokerApp();

		const reg = await request(app)
			.post('/register')
			.send({ redirect_uris: [CLIENT_REDIRECT] });
		expect(reg.status).toBe(201);
		const clientId = reg.body.client_id as string;

		const { verifier, challenge } = await generatePkcePair();
		const auth = await request(app).get('/authorize').query({
			client_id: clientId,
			redirect_uri: CLIENT_REDIRECT,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state: 'client-state',
		});
		expect(auth.status).toBe(302);
		const creatioUrl = new URL(auth.headers.location);
		expect(creatioUrl.pathname).toContain('/connect/authorize');
		// Broker's own Creatio-leg PKCE challenge, distinct from the client's.
		expect(creatioUrl.searchParams.get('code_challenge')).toBeTruthy();
		expect(creatioUrl.searchParams.get('code_challenge')).not.toBe(challenge);
		const brokerState = creatioUrl.searchParams.get('state')!;

		stubCreatioToken('api-user');
		const cb = await request(app)
			.get('/oauth/callback')
			.query({ code: 'creatio-code', state: brokerState });
		expect(cb.status).toBe(302);
		const clientRedirect = new URL(cb.headers.location);
		expect(clientRedirect.origin + clientRedirect.pathname).toBe(CLIENT_REDIRECT);
		expect(clientRedirect.searchParams.get('state')).toBe('client-state');
		const ourCode = clientRedirect.searchParams.get('code')!;

		const tok = await request(app).post('/token').type('form').send({
			grant_type: 'authorization_code',
			code: ourCode,
			redirect_uri: CLIENT_REDIRECT,
			client_id: clientId,
			code_verifier: verifier,
		});
		expect(tok.status).toBe(200);
		expect(tok.body.access_token).toBeTruthy();
		expect(tok.body.refresh_token).toBeTruthy();

		// Refresh works while the session is held.
		const refreshed = await request(app).post('/token').type('form').send({
			grant_type: 'refresh_token',
			refresh_token: tok.body.refresh_token,
			client_id: clientId,
		});
		expect(refreshed.status).toBe(200);
		expect(refreshed.body.refresh_token).not.toBe(tok.body.refresh_token);

		// Revoke (RFC 7009) → 200, and the rotated refresh token no longer works.
		const rev = await request(app)
			.post('/revoke')
			.type('form')
			.send({ token: refreshed.body.access_token });
		expect(rev.status).toBe(200);
		const afterRevoke = await request(app).post('/token').type('form').send({
			grant_type: 'refresh_token',
			refresh_token: refreshed.body.refresh_token,
			client_id: clientId,
		});
		expect(afterRevoke.status).toBe(400);
	});
});
