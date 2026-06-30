import { afterEach, describe, expect, it, vi } from 'vitest';

import { ODataMetadataStore } from '../../src/creatio/services/odata/metadata-store';

const META_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Creatio">
      <EntityType Name="Contact">
        <Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Guid" Nullable="false"/>
        <Property Name="Name" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="EntityContainer">
        <EntitySet Name="Contact" EntityType="Creatio.Contact"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const TTL_MS = 30 * 60 * 1000;

describe('ODataMetadataStore caching + TTL (H3)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('caches parsed $metadata and re-fetches only after the TTL', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		let fetchTextCalls = 0;
		const fakeClient = {
			normalizedBaseUrl: 'https://x',
			async getXmlHeaders() {
				return {};
			},
			async fetchText() {
				fetchTextCalls++;
				return META_XML;
			},
		};
		const store = new ODataMetadataStore(fakeClient as never);

		await store.describeEntity('Contact');
		await store.describeEntity('Contact');
		expect(fetchTextCalls).toBe(1);

		vi.setSystemTime(TTL_MS + 1);
		await store.describeEntity('Contact');
		expect(fetchTextCalls).toBe(2);
	});

	it('describeEntity returns key + properties (with nullable) and errors for unknown sets', async () => {
		const store = new ODataMetadataStore({
			normalizedBaseUrl: 'https://x',
			async getXmlHeaders() {
				return {};
			},
			async fetchText() {
				return META_XML;
			},
		} as never);
		const desc = await store.describeEntity('Contact');
		expect(desc.entityType).toBe('Contact');
		expect(desc.key).toEqual(['Id']);
		expect(desc.properties.find((p) => p.name === 'Id')?.nullable).toBe(false);
		await expect(store.describeEntity('Ghost')).rejects.toThrow(/entity_not_found/);
	});

	it('falls back to $metadata when the service document call is not ok', async () => {
		const store = new ODataMetadataStore({
			normalizedBaseUrl: 'https://x',
			async getJsonHeaders() {
				return {};
			},
			async getXmlHeaders() {
				return {};
			},
			async fetchWithAuth() {
				return { ok: false, status: 500 } as never;
			},
			async fetchText() {
				return META_XML;
			},
		} as never);
		expect(await store.listEntitySets()).toEqual(['Contact']);
	});

	it('caches the listEntitySets result within the TTL', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		let serviceCalls = 0;
		const fakeClient = {
			normalizedBaseUrl: 'https://x',
			async getJsonHeaders() {
				return {};
			},
			async getXmlHeaders() {
				return {};
			},
			async fetchWithAuth() {
				serviceCalls++;
				return {
					ok: true,
					async json() {
						return { value: [{ name: 'Contact' }, { name: 'Account' }] };
					},
				};
			},
		};
		const store = new ODataMetadataStore(fakeClient as never);

		expect(await store.listEntitySets()).toEqual(['Contact', 'Account']);
		await store.listEntitySets();
		expect(serviceCalls).toBe(1);

		vi.setSystemTime(TTL_MS + 1);
		await store.listEntitySets();
		expect(serviceCalls).toBe(2);
	});

	it('isolates parsed metadata per base URL and does not thrash on a tenant switch', async () => {
		let fetchTextCalls = 0;
		const client = {
			normalizedBaseUrl: 'https://a',
			async getXmlHeaders() {
				return {};
			},
			async fetchText() {
				fetchTextCalls++;
				return META_XML;
			},
		};
		const store = new ODataMetadataStore(client as never);

		await store.describeEntity('Contact'); // tenant A → fetch #1
		expect(fetchTextCalls).toBe(1);
		client.normalizedBaseUrl = 'https://b';
		await store.describeEntity('Contact'); // tenant B → fetch #2
		expect(fetchTextCalls).toBe(2);
		// Switching back must hit each tenant's own cached document, not re-fetch. The prior
		// single-slot store would have re-fetched A (then B) on every switch — fetch #3, #4, ...
		client.normalizedBaseUrl = 'https://a';
		await store.describeEntity('Contact');
		client.normalizedBaseUrl = 'https://b';
		await store.describeEntity('Contact');
		expect(fetchTextCalls).toBe(2);
	});

	it('evicts the least-recently-used base URL past maxTenants', async () => {
		let fetchTextCalls = 0;
		const client = {
			normalizedBaseUrl: 'https://a',
			async getXmlHeaders() {
				return {};
			},
			async fetchText() {
				fetchTextCalls++;
				return META_XML;
			},
		};
		const store = new ODataMetadataStore(client as never, undefined, 2);

		await store.describeEntity('Contact'); // A cached (#1)
		client.normalizedBaseUrl = 'https://b';
		await store.describeEntity('Contact'); // B cached (#2)
		client.normalizedBaseUrl = 'https://c';
		await store.describeEntity('Contact'); // C cached (#3) → evicts A (LRU), cap = 2
		expect(fetchTextCalls).toBe(3);
		client.normalizedBaseUrl = 'https://a';
		await store.describeEntity('Contact'); // A was evicted → re-fetch (#4)
		expect(fetchTextCalls).toBe(4);
	});
});
