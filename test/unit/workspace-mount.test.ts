import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	AuthProviderType,
	BearerAuthMode,
	ClientCacheHashClient,
	ODataCrudProvider,
	ProbingWorkspaceMountResolver,
	installWorkspaceMountDetection,
	resetWorkspaceMountDetection,
	resolveIdentityBase,
	workspaceBaseUrl,
} from '../../src/creatio';
import { BearerEdge } from '../../src/server/bearer/bearer-edge';
import { jsonResponse, makeHttpClientHarness } from '../support/http-client';

const FRAMEWORK = 'https://fw.creatio.local';
const NET8 = 'https://net8.creatio.local';

afterEach(() => {
	resetWorkspaceMountDetection();
	vi.unstubAllGlobals();
});

/** .NET 8 has no `/0` mount (the probe 404s); .NET Framework answers the probe. */
function stubRuntimes(onProbe: (url: string) => Response | Promise<Response> = defaultProbe) {
	const fetchMock = vi.fn(async (url: unknown) => onProbe(String(url)));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function defaultProbe(url: string): Response {
	return new Response(null, { status: url.startsWith(NET8) ? 404 : 302 });
}

describe('ProbingWorkspaceMountResolver', () => {
	it('detects the root mount on .NET 8 and /0 on .NET Framework with one anonymous probe', async () => {
		const fetchMock = stubRuntimes();
		const resolver = new ProbingWorkspaceMountResolver();
		expect(await resolver.resolve(NET8)).toBe('');
		expect(await resolver.resolve(FRAMEWORK)).toBe('/0');
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(`${NET8}/0/ServiceModel/AuthService.svc/Login`);
		expect(init.redirect).toBe('manual');
		expect(init.headers).toBeUndefined(); // no credentials on the probe
	});

	it('caches the verdict per base URL and coalesces concurrent first calls', async () => {
		const fetchMock = stubRuntimes();
		const resolver = new ProbingWorkspaceMountResolver();
		await Promise.all([resolver.resolve(NET8), resolver.resolve(NET8), resolver.resolve(NET8)]);
		await resolver.resolve(NET8);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to /0 on a failed probe without caching it, then self-heals', async () => {
		let fail = true;
		const fetchMock = stubRuntimes((url) => {
			if (fail) {
				throw new Error('ECONNRESET');
			}
			return defaultProbe(url);
		});
		const resolver = new ProbingWorkspaceMountResolver();
		expect(await resolver.resolve(NET8)).toBe('/0');
		fail = false;
		expect(await resolver.resolve(NET8)).toBe('');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('workspace-mount-aware routes', () => {
	it('keep the legacy /0 mount (and make no probe) until detection is installed', async () => {
		const fetchMock = stubRuntimes();
		expect(await workspaceBaseUrl(`${NET8}/`)).toBe(`${NET8}/0`);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('identity base: derived from the runtime, an explicit idBaseUrl keeps its /0 contract', async () => {
		stubRuntimes();
		installWorkspaceMountDetection(new ProbingWorkspaceMountResolver());
		expect(await resolveIdentityBase(NET8)).toBe(NET8);
		expect(await resolveIdentityBase(FRAMEWORK)).toBe(`${FRAMEWORK}/0`);
		expect(await resolveIdentityBase(`${NET8}/0`)).toBe(`${NET8}/0`);
		expect(await resolveIdentityBase(NET8, 'https://id.creatio.local')).toBe(
			'https://id.creatio.local/0',
		);
	});

	it('OData and ClientCache target the root on .NET 8', async () => {
		installWorkspaceMountDetection({ resolve: async () => '' });
		const { client, calls } = makeHttpClientHarness(() => jsonResponse({ value: [] }), NET8);
		await new ODataCrudProvider(client, {} as never).read({ entity: 'Contact' });
		await new ClientCacheHashClient(client).getHashes();
		expect(calls.map((c) => c.url)).toEqual([
			`${NET8}/odata/Contact`,
			`${NET8}/api/ClientCache/Hashes`,
		]);
	});

	it('delegated discovery advertises the runtime identity base', async () => {
		installWorkspaceMountDetection({ resolve: async () => '' });
		const app = express();
		new BearerEdge(
			{ kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Delegated } as never,
			NET8,
		).registerRoutes(app);
		const { body } = await request(app).get('/.well-known/oauth-protected-resource');
		expect(body.authorization_servers).toEqual([NET8]);
	});
});

describe('self-review regressions', () => {
	// A 5xx / 403 / 429 says nothing about the mount: it must not be cached as `/0` for the TTL.
	it.each([500, 503, 403, 429])('does not cache an inconclusive %i probe', async (status) => {
		let answer = status;
		const fetchMock = stubRuntimes(() => new Response(null, { status: answer }));
		const resolver = new ProbingWorkspaceMountResolver();
		expect(await resolver.resolve(NET8)).toBe('/0');
		answer = 404;
		expect(await resolver.resolve(NET8)).toBe('');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it.each([200, 302, 405])('treats %i as a definitive /0 mount', async (status) => {
		stubRuntimes(() => new Response(null, { status }));
		expect(await new ProbingWorkspaceMountResolver().resolve(FRAMEWORK)).toBe('/0');
	});

	// The delegated edge used its own copy of the identity-base rule and advertised `…/0/0`.
	it('delegated discovery does not double a /0 already in the base URL', async () => {
		installWorkspaceMountDetection({ resolve: async () => '/0' });
		const app = express();
		new BearerEdge(
			{ kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Delegated } as never,
			`${FRAMEWORK}/0`,
		).registerRoutes(app);
		const { body } = await request(app).get('/.well-known/oauth-protected-resource');
		expect(body.authorization_servers).toEqual([`${FRAMEWORK}/0`]);
	});
});
