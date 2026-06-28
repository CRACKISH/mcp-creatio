import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientCacheHashes } from '../../src/creatio/services/client-cache-hash-client';
import { SchemaFreshnessGate } from '../../src/creatio/services/schema-freshness-gate';

afterEach(() => {
	vi.useRealTimers();
});

function fakeClient(getHashes: () => Promise<ClientCacheHashes | null>) {
	return { getHashes: vi.fn(getHashes) };
}

function makeGate(opts: { client: ReturnType<typeof fakeClient>; ttlMs?: number }) {
	return new SchemaFreshnessGate(opts.client as never, opts.ttlMs ?? 60_000);
}

const hashes = (cacheVersion: number, entitySchema: string): ClientCacheHashes => ({
	cacheVersion,
	hashes: { 'runtime-entity-schema': entitySchema, 'features-cache': 'x' },
});

describe('SchemaFreshnessGate', () => {
	it('derives a token from cacheVersion + the runtime-entity-schema hash', async () => {
		const client = fakeClient(async () => hashes(3, 'aaa'));
		const gate = makeGate({ client });
		expect(await gate.getSchemaVersion('https://a')).toBe('v3:aaa');
	});

	it('caches the snapshot within the TTL (one fetch) and re-polls after it', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const client = fakeClient(async () => hashes(1, 'aaa'));
		const gate = makeGate({ client, ttlMs: 60_000 });

		await gate.getSchemaVersion('https://a');
		await gate.getSchemaVersion('https://a');
		expect(client.getHashes).toHaveBeenCalledTimes(1);

		vi.setSystemTime(60_001);
		await gate.getSchemaVersion('https://a');
		expect(client.getHashes).toHaveBeenCalledTimes(2);
	});

	it('reflects a data-model change once the snapshot TTL elapses', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		let entityHash = 'aaa';
		const client = fakeClient(async () => hashes(1, entityHash));
		const gate = makeGate({ client, ttlMs: 1000 });

		expect(await gate.getSchemaVersion('https://a')).toBe('v1:aaa');
		entityHash = 'bbb'; // someone added a column → Creatio's hash flips
		vi.setSystemTime(1001);
		expect(await gate.getSchemaVersion('https://a')).toBe('v1:bbb');
	});

	it('keys snapshots per base URL (no cross-tenant bleed)', async () => {
		const byBase: Record<string, ClientCacheHashes> = {
			'https://a': hashes(1, 'aaa'),
			'https://b': hashes(9, 'zzz'),
		};
		let current = 'https://a';
		const client = fakeClient(async () => byBase[current]!);
		const gate = makeGate({ client });

		current = 'https://a';
		expect(await gate.getSchemaVersion('https://a')).toBe('v1:aaa');
		current = 'https://b';
		expect(await gate.getSchemaVersion('https://b')).toBe('v9:zzz');
		// Each base URL got its own fetch + snapshot.
		expect(client.getHashes).toHaveBeenCalledTimes(2);
	});

	it('degrades to a coarse time-bucketed token when the endpoint is unavailable', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const client = fakeClient(async () => null);
		const gate = makeGate({ client, ttlMs: 1000 });

		const t0 = await gate.getSchemaVersion('https://a');
		expect(t0).toMatch(/^fallback:/);

		// Same 5-min bucket → same token after TTL re-poll.
		vi.setSystemTime(1001);
		expect(await gate.getSchemaVersion('https://a')).toBe(t0);

		// Next 5-min bucket → token advances, so caches still refresh on a fallback cadence.
		vi.setSystemTime(5 * 60 * 1000 + 1);
		expect(await gate.getSchemaVersion('https://a')).not.toBe(t0);
	});
});
