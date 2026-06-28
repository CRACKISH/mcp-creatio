import { describe, expect, it, vi } from 'vitest';

import { DataServiceSchemaProvider } from '../../src/creatio/services/dataservice/data-service-schema';
import { ODataMetadataStore } from '../../src/creatio/services/odata/metadata-store';

/** Minimal RuntimeEntitySchemaRequest body for an entity with one column. */
function schemaBody(name: string) {
	return {
		schema: {
			name,
			columns: { Items: { Id: { name: 'Id', dataValueType: 0 } } },
		},
	};
}

/** A fake DataServiceTransport: records `post` calls and exposes a mutable base URL. */
function fakeTransport(baseUrl = 'https://a') {
	const post = vi.fn(async (_op: string, payload: any) => schemaBody(payload.name));
	return {
		baseUrl,
		post,
		setBaseUrl(url: string) {
			(this as { baseUrl: string }).baseUrl = url;
		},
	};
}

/** A fake SchemaFreshnessGate returning a controllable version per call. */
function fakeGate(initial = 'v1:aaa') {
	let version = initial;
	return {
		getSchemaVersion: vi.fn(async () => version),
		set(v: string) {
			version = v;
		},
	};
}

describe('DataServiceSchemaProvider freshness gating', () => {
	it('serves from cache while the version is unchanged (single fetch)', async () => {
		const transport = fakeTransport();
		const gate = fakeGate();
		const provider = new DataServiceSchemaProvider(
			transport as never,
			undefined,
			undefined,
			gate as never,
		);
		await provider.describeEntity('Contact');
		await provider.columnTypes('Contact');
		expect(transport.post).toHaveBeenCalledTimes(1);
	});

	it('refetches when the freshness version changes (data model changed)', async () => {
		const transport = fakeTransport();
		const gate = fakeGate('v1:aaa');
		const provider = new DataServiceSchemaProvider(
			transport as never,
			undefined,
			undefined,
			gate as never,
		);
		await provider.describeEntity('Contact');
		gate.set('v1:bbb'); // Creatio's runtime-entity-schema hash flipped
		await provider.describeEntity('Contact');
		expect(transport.post).toHaveBeenCalledTimes(2);
	});

	it('keys the cache per base URL (no cross-tenant reuse)', async () => {
		const transport = fakeTransport('https://a');
		const gate = fakeGate('v1:aaa'); // same version across tenants
		const provider = new DataServiceSchemaProvider(
			transport as never,
			undefined,
			undefined,
			gate as never,
		);
		await provider.describeEntity('Contact');
		transport.setBaseUrl('https://b'); // a different tenant via the gateway override
		await provider.describeEntity('Contact');
		expect(transport.post).toHaveBeenCalledTimes(2);
	});

	it('without a gate, behaves as before (cached, single fetch)', async () => {
		const transport = fakeTransport();
		const provider = new DataServiceSchemaProvider(transport as never);
		await provider.describeEntity('Contact');
		await provider.describeEntity('Contact');
		expect(transport.post).toHaveBeenCalledTimes(1);
	});
});

const META_XML = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0">
  <edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Creatio">
      <EntityType Name="Contact"><Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Guid" Nullable="false"/></EntityType>
      <EntityContainer Name="EntityContainer">
        <EntitySet Name="Contact" EntityType="Creatio.Contact"/></EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

/** Fake CreatioHttpClient for the metadata store: counts $metadata fetches, mutable base URL. */
function fakeOdataClient() {
	const state = { normalizedBaseUrl: 'https://a', fetchTextCalls: 0 };
	return {
		get normalizedBaseUrl() {
			return state.normalizedBaseUrl;
		},
		setBaseUrl(url: string) {
			state.normalizedBaseUrl = url;
		},
		get fetchTextCalls() {
			return state.fetchTextCalls;
		},
		async getXmlHeaders() {
			return {};
		},
		async fetchText() {
			state.fetchTextCalls++;
			return META_XML;
		},
	};
}

describe('ODataMetadataStore freshness gating', () => {
	it('refetches $metadata when the freshness version changes', async () => {
		const client = fakeOdataClient();
		const gate = fakeGate('v1:aaa');
		const store = new ODataMetadataStore(client as never, gate as never);
		await store.describeEntity('Contact');
		await store.describeEntity('Contact');
		expect(client.fetchTextCalls).toBe(1);
		gate.set('v1:bbb');
		await store.describeEntity('Contact');
		expect(client.fetchTextCalls).toBe(2);
	});

	it('refetches $metadata when the base URL changes (different tenant)', async () => {
		const client = fakeOdataClient();
		const gate = fakeGate('v1:aaa');
		const store = new ODataMetadataStore(client as never, gate as never);
		await store.describeEntity('Contact');
		client.setBaseUrl('https://b');
		await store.describeEntity('Contact');
		expect(client.fetchTextCalls).toBe(2);
	});
});
