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
		sentBody: undefined,
	};
	r.status = vi.fn((c: number) => ((r.statusCode = c), r));
	r.json = vi.fn((b: unknown) => ((r.jsonBody = b), r));
	r.send = vi.fn((b: unknown) => ((r.sentBody = b), r));
	r.redirect = vi.fn((_c: number, url: string) => ((r.redirectedTo = url), r));
	r.setHeader = vi.fn((k: string, v: string) => {
		(r.headers as Record<string, string>)[k] = v;
	});
	return r;
}

beforeEach(() => resetSessionContext());
afterEach(() => vi.unstubAllGlobals());

describe('BrokerHandlers metadata', () => {
	it('handleMetadata returns RFC 8414 authorization-server metadata', () => {
		const r = res();
		makeHandlers().handleMetadata(req({}) as never, r as never);
		const body = r.jsonBody as Record<string, unknown>;
		expect(body.issuer).toBe('http://localhost:3000');
		expect(body.authorization_endpoint).toBe('http://localhost:3000/authorize');
		expect(body.token_endpoint).toBe('http://localhost:3000/token');
		expect(body.code_challenge_methods_supported).toEqual(['S256']);
	});

	it('handleProtectedResourceMetadata advertises this origin as the AS (RFC 9728)', () => {
		const r = res();
		makeHandlers().handleProtectedResourceMetadata(req({}) as never, r as never);
		const body = r.jsonBody as Record<string, unknown>;
		expect(body.resource).toBe('http://localhost:3000/mcp');
		expect(body.authorization_servers).toEqual(['http://localhost:3000']);
	});
});

describe('BrokerHandlers.handleRegister validation', () => {
	it('rejects a registration with no/invalid redirect_uris (400)', () => {
		const r = res();
		makeHandlers().handleRegister(req({ body: {} }) as never, r as never);
		expect(r.statusCode).toBe(400);
		expect((r.jsonBody as { error: string }).error).toBe('invalid_request');
	});
});

describe('BrokerHandlers.handleAuthorize edges', () => {
	it('rejects a missing/disallowed redirect_uri with 400', async () => {
		const r = res();
		await makeHandlers().handleAuthorize(
			req({ query: { redirect_uri: 'https://evil.example.com/cb' } }) as never,
			r as never,
		);
		expect(r.statusCode).toBe(400);
	});

	it('redirects validation errors back to the client redirect_uri (_redirectError)', async () => {
		const h = makeHandlers();
		// Allowed redirect but an invalid request (no PKCE) for an unknown but auto-registerable client.
		const r = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: 'claude-x',
					redirect_uri: CLIENT_REDIRECT,
					response_type: 'token', // unsupported → validation error
					code_challenge: 'c',
					code_challenge_method: 'S256',
					state: 'st-1',
				},
			}) as never,
			r as never,
		);
		const url = new URL(r.redirectedTo as string);
		expect(url.origin + url.pathname).toBe(CLIENT_REDIRECT);
		expect(url.searchParams.get('error')).toBe('unsupported_response_type');
		expect(url.searchParams.get('state')).toBe('st-1');
	});
});

describe('BrokerHandlers.handleCallback edges', () => {
	it('400 when code or state is missing', async () => {
		const r = res();
		await makeHandlers().handleCallback(req({ query: {} }) as never, r as never);
		expect(r.statusCode).toBe(400);
		expect(r.sentBody).toMatch(/Missing code or state/);
	});

	it('400 for an unknown/expired broker state', async () => {
		const r = res();
		await makeHandlers().handleCallback(
			req({ query: { code: 'c', state: 'unknown' } }) as never,
			r as never,
		);
		expect(r.statusCode).toBe(400);
		expect(r.sentBody).toMatch(/Unknown or expired/);
	});

	it('502 when the Creatio code exchange fails', async () => {
		const h = makeHandlers();
		const { challenge } = await generatePkcePair();
		const authRes = res();
		await h.handleAuthorize(
			req({
				query: {
					client_id: 'claude-x',
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
			vi.fn(async () => new Response('nope', { status: 500 })),
		);
		const r = res();
		await h.handleCallback(
			req({ query: { code: 'c', state: brokerState } }) as never,
			r as never,
		);
		expect(r.statusCode).toBe(502);
	});
});

describe('BrokerHandlers.handleToken error path', () => {
	it('returns 400 for an invalid authorization_code grant', async () => {
		const r = res();
		await makeHandlers().handleToken(
			req({
				body: {
					grant_type: 'authorization_code',
					client_id: 'c1',
					code: 'bad',
					redirect_uri: CLIENT_REDIRECT,
					code_verifier: 'v',
				},
			}) as never,
			r as never,
		);
		expect(r.statusCode).toBe(400);
	});
});
