import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientCacheHashClient } from '../../src/creatio/services/client-cache-hash-client';
import { jsonResponse, makeHttpClientHarness, textResponse } from '../support/http-client';

afterEach(() => {
	vi.unstubAllGlobals();
});

const HASHES_BODY = {
	cacheVersion: 7,
	hashes: [
		{ name: 'runtime-entity-schema', value: 'abc123' },
		{ name: 'features-cache', value: 'def456' },
	],
};

describe('ClientCacheHashClient', () => {
	it('GETs /0/api/ClientCache/Hashes and shapes the response into a name→hash map', async () => {
		const { client, calls } = makeHttpClientHarness(() => jsonResponse(HASHES_BODY));
		const result = await new ClientCacheHashClient(client).getHashes();

		expect(calls[0]!.url).toBe('https://tenant.creatio.local/0/api/ClientCache/Hashes');
		expect(calls[0]!.init.method ?? 'GET').toMatch(/GET/i);
		expect(result).toEqual({
			cacheVersion: 7,
			hashes: { 'runtime-entity-schema': 'abc123', 'features-cache': 'def456' },
		});
	});

	it('defaults cacheVersion to 0 when absent / non-numeric', async () => {
		const { client } = makeHttpClientHarness(() =>
			jsonResponse({ hashes: [{ name: 'runtime-entity-schema', value: 'x' }] }),
		);
		const result = await new ClientCacheHashClient(client).getHashes();
		expect(result?.cacheVersion).toBe(0);
		expect(result?.hashes['runtime-entity-schema']).toBe('x');
	});

	it('returns null on a non-2xx response (graceful degrade)', async () => {
		const { client } = makeHttpClientHarness(() => jsonResponse({ error: 'no' }, 500));
		expect(await new ClientCacheHashClient(client).getHashes()).toBeNull();
	});

	it('returns null on a malformed body (no hashes array)', async () => {
		const { client } = makeHttpClientHarness(() => jsonResponse({ nope: true }));
		expect(await new ClientCacheHashClient(client).getHashes()).toBeNull();
	});

	it('returns null when the body is not JSON', async () => {
		const { client } = makeHttpClientHarness(() => textResponse('<html>login</html>'));
		expect(await new ClientCacheHashClient(client).getHashes()).toBeNull();
	});

	it('returns null and never throws on a network error', async () => {
		const { client } = makeHttpClientHarness(() => {
			throw new Error('ECONNREFUSED');
		});
		expect(await new ClientCacheHashClient(client).getHashes()).toBeNull();
	});
});
