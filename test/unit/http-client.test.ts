import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatioHttpClient } from '../../src/creatio/services/http-client';

function makeClient(refresh = vi.fn(async () => {})) {
	const provider = {
		async getHeaders() {
			return { Authorization: 'Bearer t' };
		},
		refresh,
	};
	const authManager = { getProvider: () => provider };
	const client = new CreatioHttpClient(
		{ baseUrl: 'https://tenant.creatio.local/', auth: { kind: 'oauth2' } } as never,
		authManager as never,
	);
	return { client, refresh };
}

afterEach(() => vi.unstubAllGlobals());

describe('CreatioHttpClient', () => {
	it('normalizes the base URL (trailing slash stripped)', () => {
		const { client } = makeClient();
		expect(client.normalizedBaseUrl).toBe('https://tenant.creatio.local');
	});

	it('refreshes once on a 401 and retries the request', async () => {
		const { client, refresh } = makeClient();
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				n++;
				return new Response('', { status: n === 1 ? 401 : 200 });
			}),
		);
		const res = await client.fetchWithAuth('https://x/y', async () => ({}));
		expect(res.status).toBe(200);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(n).toBe(2);
	});

	it('treats a followed redirect to an HTML login page as a dead session and re-auths once', async () => {
		const { client, refresh } = makeClient();
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				n++;
				// 1st call: the expired cookie session bounced to a login page (followed → 200 HTML).
				if (n === 1) {
					return {
						status: 200,
						redirected: true,
						headers: { get: () => 'text/html; charset=utf-8' },
					};
				}
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}),
		);
		const res = (await client.fetchWithAuth('https://x/y', async () => ({}))) as Response;
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(n).toBe(2);
		expect(res.status).toBe(200);
	});

	it('does NOT treat a redirected JSON response as a dead session', async () => {
		const { client, refresh } = makeClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				status: 200,
				redirected: true,
				headers: { get: () => 'application/json' },
			})),
		);
		await client.fetchWithAuth('https://x/y', async () => ({}));
		expect(refresh).not.toHaveBeenCalled();
	});

	it('returns the 401 response if a single refresh does not help', async () => {
		const { client, refresh } = makeClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 401 })),
		);
		const res = await client.fetchWithAuth('https://x/y', async () => ({}));
		expect(res.status).toBe(401);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('fetchJson throws on a non-ok response and parses JSON on success', async () => {
		const { client } = makeClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })),
		);
		expect(await client.fetchJson('https://x', async () => ({}))).toEqual({ a: 1 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 })),
		);
		await expect(client.fetchJson('https://x', async () => ({}))).rejects.toThrow(
			/creatio_http_error:500/,
		);
	});

	it('fetchText returns the body on success and throws on a non-ok response', async () => {
		const { client } = makeClient();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('hello-text', { status: 200 })),
		);
		expect(await client.fetchText('https://x', async () => ({}))).toBe('hello-text');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 404 })),
		);
		await expect(client.fetchText('https://x', async () => ({}))).rejects.toThrow(
			/creatio_http_error:404/,
		);
	});

	it('builds JSON and XML headers and a POST request body', async () => {
		const { client } = makeClient();
		expect((await client.getJsonHeaders()).Authorization).toBe('Bearer t');
		expect(await client.getXmlHeaders()).toBeTruthy();
		const post = await client.createPostRequest({ a: 1 });
		expect(post.method).toBe('POST');
		expect(JSON.parse(post.body as string)).toEqual({ a: 1 });
		const empty = await client.createPostRequest();
		expect(JSON.parse(empty.body as string)).toEqual({});
	});

	it('executeWithTiming routes success and error and rethrows on throw', async () => {
		const { client } = makeClient();
		const ok = await client.executeWithTiming(
			'op',
			'https://x',
			async () => new Response('', { status: 200 }),
			async () => 'success',
			async () => 'error',
		);
		expect(ok).toBe('success');

		const errored = await client.executeWithTiming(
			'op',
			'https://x',
			async () => new Response('', { status: 500 }),
			async () => 'success',
			async () => 'error',
		);
		expect(errored).toBe('error');

		await expect(
			client.executeWithTiming(
				'op',
				'https://x',
				async () => {
					throw new Error('network down');
				},
				async () => 'success',
				async () => 'error',
			),
		).rejects.toThrow(/network down/);
	});
});
