import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { CreatioOAuthClient } from '../../src/creatio/auth/providers/creatio-oauth-client';
import { BrokerHandlers } from '../../src/server/http/broker-handlers';
import { OAuthServer } from '../../src/server/oauth';
import { SessionContext } from '../../src/sessions/session-context';
import { generatePkcePair } from '../../src/utils';
import { resetSessionContext } from '../support/test-server';

const CLIENT_REDIRECT = 'http://localhost:7777/cb';

function makeHandlers() {
	const oauth = new OAuthServer('test-jwt-secret');
	const creatio = new CreatioOAuthClient('https://t.creatio.local', {
		kind: AuthProviderType.Broker,
		clientId: 'creatio-app',
		jwtSecret: 'test-jwt-secret',
	} as never);
	return new BrokerHandlers(oauth, creatio, SessionContext.instance);
}

function req(opts: {
	query?: Record<string, unknown>;
	body?: unknown;
	headers?: Record<string, string>;
}) {
	return {
		query: opts.query ?? {},
		body: opts.body,
		headers: opts.headers ?? {},
		protocol: 'http',
		get: () => 'localhost:3000',
	} as Record<string, unknown>;
}
function res() {
	const r: Record<string, unknown> = {
		statusCode: 200,
		headers: {},
		redirectedTo: undefined,
		jsonBody: undefined,
	};
	r.status = vi.fn((c: number) => ((r.statusCode = c), r));
	r.json = vi.fn((b: unknown) => ((r.jsonBody = b), r));
	r.redirect = vi.fn((_c: number, url: string) => ((r.redirectedTo = url), r));
	r.setHeader = vi.fn((k: string, v: string) => {
		(r.headers as Record<string, string>)[k] = v;
	});
	return r;
}

function jsonOk(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

beforeEach(() => resetSessionContext());
afterEach(() => vi.unstubAllGlobals());

describe('BrokerHandlers — full authorization_code broker flow', () => {
	it('register → authorize → callback → token → mcpAuth, end to end', async () => {
		const h = makeHandlers();

		// 1) Dynamic client registration.
		const regRes = res();
		h.handleRegister(
			req({ body: { redirect_uris: [CLIENT_REDIRECT] } }) as never,
			regRes as never,
		);
		expect(regRes.statusCode).toBe(201);
		const clientId = (regRes.jsonBody as { client_id: string }).client_id;

		// 2) Client authorize (with its own PKCE) → redirect to Creatio.
		const { verifier: clientVerifier, challenge: clientChallenge } = await generatePkcePair();
		const authRes = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: clientId,
					redirect_uri: CLIENT_REDIRECT,
					response_type: 'code',
					code_challenge: clientChallenge,
					code_challenge_method: 'S256',
					state: 'client-state-1',
				},
			}) as never,
			authRes as never,
		);
		const creatioUrl = new URL(authRes.redirectedTo as string);
		expect(creatioUrl.pathname).toContain('/0/connect/authorize');
		// Our OWN Creatio-leg PKCE challenge is present and DIFFERENT from the client's (no collision).
		expect(creatioUrl.searchParams.get('code_challenge')).toBeTruthy();
		expect(creatioUrl.searchParams.get('code_challenge')).not.toBe(clientChallenge);
		const brokerState = creatioUrl.searchParams.get('state')!;
		expect(brokerState).toBeTruthy();

		// 3) Creatio calls back → broker exchanges (mocked) → stores tokens → issues OUR code.
		const creatioToken = jwt.sign({ sub: 'creatio-user-1' }, 'irrelevant', { expiresIn: 3600 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({ access_token: creatioToken, refresh_token: 'RT', expires_in: 3600 }),
			),
		);
		const cbRes = res();
		await h.handleCallback(
			req({ query: { code: 'creatio-code', state: brokerState } }) as never,
			cbRes as never,
		);
		const clientRedirect = new URL(cbRes.redirectedTo as string);
		expect(clientRedirect.origin + clientRedirect.pathname).toBe(CLIENT_REDIRECT);
		expect(clientRedirect.searchParams.get('state')).toBe('client-state-1');
		const ourCode = clientRedirect.searchParams.get('code')!;
		expect(ourCode).toBeTruthy();
		// Creatio tokens stored under the user derived from the token's sub.
		expect(
			(await SessionContext.instance.getTokensForUser('creatio-user-1'))?.accessToken,
		).toBe(creatioToken);

		// 4) Client exchanges OUR code (+ its verifier) for OUR token.
		const tokRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'authorization_code',
					code: ourCode,
					redirect_uri: CLIENT_REDIRECT,
					client_id: clientId,
					code_verifier: clientVerifier,
				},
			}) as never,
			tokRes as never,
		);
		const ourToken = (tokRes.jsonBody as { access_token: string }).access_token;
		expect(ourToken).toBeTruthy();

		// 5) /mcp guard accepts OUR token (Creatio tokens still held) and exposes the userKey.
		const next = vi.fn();
		const guardReq = req({ headers: { authorization: `Bearer ${ourToken}` } });
		await h.mcpAuth()(guardReq as never, res() as never, next);
		expect(next).toHaveBeenCalled();
		expect(guardReq.userKey).toBe('creatio-user-1');

		// 6) After the broker loses its in-memory Creatio tokens (e.g. a restart), the SAME valid
		//    client token is challenged with invalid_token so the client re-runs OAuth.
		await SessionContext.instance.deleteTokensForUser('creatio-user-1');
		const next2 = vi.fn();
		const r2 = res();
		await h.mcpAuth()(
			req({ headers: { authorization: `Bearer ${ourToken}` } }) as never,
			r2 as never,
			next2,
		);
		expect(next2).not.toHaveBeenCalled();
		expect(r2.statusCode).toBe(401);
		expect((r2.headers as Record<string, string>)['WWW-Authenticate']).toContain(
			'error="invalid_token"',
		);
	});

	it('mcpAuth rejects a missing token with a WWW-Authenticate challenge', async () => {
		const h = makeHandlers();
		const r = res();
		const next = vi.fn();
		await h.mcpAuth()(req({}) as never, r as never, next);
		expect(r.statusCode).toBe(401);
		expect((r.headers as Record<string, string>)['WWW-Authenticate']).toContain(
			'resource_metadata=',
		);
		expect(next).not.toHaveBeenCalled();
	});

	it('refresh_token grant rotates and re-issues without re-auth (while session held)', async () => {
		const h = makeHandlers();
		const regRes = res();
		h.handleRegister(
			req({ body: { redirect_uris: [CLIENT_REDIRECT] } }) as never,
			regRes as never,
		);
		const clientId = (regRes.jsonBody as { client_id: string }).client_id;
		const { verifier, challenge } = await generatePkcePair();
		const authRes = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: clientId,
					redirect_uri: CLIENT_REDIRECT,
					response_type: 'code',
					code_challenge: challenge,
					code_challenge_method: 'S256',
				},
			}) as never,
			authRes as never,
		);
		const brokerState = new URL(authRes.redirectedTo as string).searchParams.get('state')!;
		const creatioToken = jwt.sign({ sub: 'refresh-user' }, 'irrelevant', { expiresIn: 3600 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({ access_token: creatioToken, refresh_token: 'RT', expires_in: 3600 }),
			),
		);
		const cbRes = res();
		await h.handleCallback(
			req({ query: { code: 'c', state: brokerState } }) as never,
			cbRes as never,
		);
		const ourCode = new URL(cbRes.redirectedTo as string).searchParams.get('code')!;
		const tokRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'authorization_code',
					code: ourCode,
					redirect_uri: CLIENT_REDIRECT,
					client_id: clientId,
					code_verifier: verifier,
				},
			}) as never,
			tokRes as never,
		);
		const issued = tokRes.jsonBody as { access_token: string; refresh_token: string };
		expect(issued.refresh_token).toBeTruthy();

		// Refresh while the broker still holds the Creatio tokens → fresh access + ROTATED refresh.
		const refRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'refresh_token',
					refresh_token: issued.refresh_token,
					client_id: clientId,
				},
			}) as never,
			refRes as never,
		);
		const refreshed = refRes.jsonBody as { access_token: string; refresh_token: string };
		expect(refreshed.access_token).toBeTruthy();
		expect(refreshed.refresh_token).not.toBe(issued.refresh_token);

		// The old refresh token is single-use — reusing it now fails.
		const reuseRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'refresh_token',
					refresh_token: issued.refresh_token,
					client_id: clientId,
				},
			}) as never,
			reuseRes as never,
		);
		expect(reuseRes.statusCode).toBe(400);

		// Once the broker loses the Creatio tokens, even a valid refresh token is rejected (re-auth).
		await SessionContext.instance.deleteTokensForUser('refresh-user');
		const goneRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'refresh_token',
					refresh_token: refreshed.refresh_token,
					client_id: clientId,
				},
			}) as never,
			goneRes as never,
		);
		expect(goneRes.statusCode).toBe(400);
	});

	it('an access token bound to one origin is rejected at a different origin (aud/iss binding)', async () => {
		const h = makeHandlers();
		const regRes = res();
		h.handleRegister(
			req({ body: { redirect_uris: [CLIENT_REDIRECT] } }) as never,
			regRes as never,
		);
		const clientId = (regRes.jsonBody as { client_id: string }).client_id;
		const { verifier, challenge } = await generatePkcePair();
		const authRes = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: clientId,
					redirect_uri: CLIENT_REDIRECT,
					response_type: 'code',
					code_challenge: challenge,
					code_challenge_method: 'S256',
				},
			}) as never,
			authRes as never,
		);
		const brokerState = new URL(authRes.redirectedTo as string).searchParams.get('state')!;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({
					access_token: jwt.sign({ sub: 'aud-user' }, 'x'),
					refresh_token: 'RT',
					expires_in: 3600,
				}),
			),
		);
		const cbRes = res();
		await h.handleCallback(
			req({ query: { code: 'c', state: brokerState } }) as never,
			cbRes as never,
		);
		const ourCode = new URL(cbRes.redirectedTo as string).searchParams.get('code')!;
		const tokRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'authorization_code',
					code: ourCode,
					redirect_uri: CLIENT_REDIRECT,
					client_id: clientId,
					code_verifier: verifier,
				},
			}) as never,
			tokRes as never,
		);
		const ourToken = (tokRes.jsonBody as { access_token: string }).access_token;

		// Same origin (localhost:3000) → accepted.
		const okNext = vi.fn();
		await h.mcpAuth()(
			req({ headers: { authorization: `Bearer ${ourToken}` } }) as never,
			res() as never,
			okNext,
		);
		expect(okNext).toHaveBeenCalled();

		// A request arriving with a DIFFERENT host → aud/iss mismatch → rejected.
		const otherHostReq = {
			query: {},
			body: undefined,
			headers: { authorization: `Bearer ${ourToken}` },
			protocol: 'http',
			get: () => 'evil.example.com',
		} as Record<string, unknown>;
		const badNext = vi.fn();
		const badRes = res();
		await h.mcpAuth()(otherHostReq as never, badRes as never, badNext);
		expect(badNext).not.toHaveBeenCalled();
		expect(badRes.statusCode).toBe(401);
	});

	it('token exchange fails for a wrong PKCE verifier', async () => {
		const h = makeHandlers();
		const regRes = res();
		h.handleRegister(
			req({ body: { redirect_uris: [CLIENT_REDIRECT] } }) as never,
			regRes as never,
		);
		const clientId = (regRes.jsonBody as { client_id: string }).client_id;
		const { challenge } = await generatePkcePair();
		const authRes = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: clientId,
					redirect_uri: CLIENT_REDIRECT,
					response_type: 'code',
					code_challenge: challenge,
					code_challenge_method: 'S256',
				},
			}) as never,
			authRes as never,
		);
		const brokerState = new URL(authRes.redirectedTo as string).searchParams.get('state')!;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonOk({ access_token: jwt.sign({ sub: 'u' }, 'x'), expires_in: 3600 }),
			),
		);
		const cbRes = res();
		await h.handleCallback(
			req({ query: { code: 'c', state: brokerState } }) as never,
			cbRes as never,
		);
		const ourCode = new URL(cbRes.redirectedTo as string).searchParams.get('code')!;
		const tokRes = res();
		await h.handleToken(
			req({
				body: {
					grant_type: 'authorization_code',
					code: ourCode,
					redirect_uri: CLIENT_REDIRECT,
					client_id: clientId,
					code_verifier: 'WRONG-VERIFIER',
				},
			}) as never,
			tokRes as never,
		);
		expect(tokRes.statusCode).toBe(400);
	});
});
