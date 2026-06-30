import { XMLParser } from 'fast-xml-parser';

import log from '../../../log';
import { EntitySchemaDescription } from '../../contracts';
import { CreatioHttpClient } from '../http-client';
import { SchemaFreshnessGate } from '../schema-freshness-gate';
import { VersionedTtlCache } from '../versioned-ttl-cache';

import { odataRoot } from './odata-routes';

/** A parsed `$metadata` document for one base URL. The parsed tree and the two lookup indexes are
 *  built lazily (and absent on a fresh fetch) so they cost nothing for a tenant only ever listed.
 *  Freshness/TTL/eviction live in {@link VersionedTtlCache}, not here. */
interface MetadataDoc {
	xml: string;
	parsed?: any;
	entityTypeBySet?: Map<string, string>;
	typeNodeByName?: Map<string, any>;
}

export class ODataMetadataStore {
	private static readonly METADATA_TTL_MS = 30 * 60 * 1000;
	/** Max distinct base URLs (tenants) retained per cache; least-recently-used dropped past it. */
	private static readonly DEFAULT_MAX_TENANTS = 100;
	private readonly _client: CreatioHttpClient;
	private readonly _freshness: SchemaFreshnessGate | undefined;
	// Keyed by base URL so a multi-tenant gateway never serves tenant A's metadata to B AND never
	// thrashes: tenant A's parsed document survives an interleaved call to B (the prior single-slot
	// design re-fetched A's whole $metadata on every tenant switch). Version-stamping + TTL + LRU are
	// all the shared cache's job.
	private readonly _docs: VersionedTtlCache<MetadataDoc>;
	private readonly _entitySets: VersionedTtlCache<string[]>;

	constructor(
		client: CreatioHttpClient,
		freshness?: SchemaFreshnessGate,
		maxTenants: number = ODataMetadataStore.DEFAULT_MAX_TENANTS,
	) {
		this._client = client;
		this._freshness = freshness;
		this._docs = new VersionedTtlCache<MetadataDoc>(ODataMetadataStore.METADATA_TTL_MS, maxTenants);
		this._entitySets = new VersionedTtlCache<string[]>(
			ODataMetadataStore.METADATA_TTL_MS,
			maxTenants,
		);
	}

	/** Freshness version for the current request's base URL (empty when no gate is wired, which
	 *  keeps the cache purely TTL-driven — the prior behaviour). */
	private async _version(): Promise<string> {
		return this._freshness
			? this._freshness.getSchemaVersion(this._client.normalizedBaseUrl)
			: '';
	}

	private _arrayify<T>(value: T | T[] | undefined | null): T[] {
		if (value == null) {
			return [];
		}
		return Array.isArray(value) ? value : [value];
	}

	/** The cached metadata document for the current request's base URL, fetching/refreshing the raw
	 *  `$metadata` on a miss (different tenant, stale TTL, or a changed freshness version). */
	private async _getDoc(): Promise<MetadataDoc> {
		const baseUrl = this._client.normalizedBaseUrl;
		const version = await this._version();
		return this._docs.getOrLoad(baseUrl, version, async () => {
			const headers = await this._client.getXmlHeaders();
			const metadataUrl = `${odataRoot(baseUrl)}/$metadata`;
			const xml = await this._client.fetchText(metadataUrl, async () => ({ headers }));
			return { xml };
		});
	}

	private _getParsedMetadata(doc: MetadataDoc): any {
		if (!doc.parsed) {
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: '@_',
			});
			doc.parsed = parser.parse(doc.xml);
		}
		return doc.parsed;
	}

	private _extractSchemas(metadata: any): any[] {
		const dataServices = metadata['edmx:Edmx']?.['edmx:DataServices'];
		return this._arrayify<any>(dataServices?.Schema);
	}

	private async _tryGetEntitySetsFromService(): Promise<string[] | null> {
		try {
			const serviceUrl = `${odataRoot(this._client.normalizedBaseUrl)}/`;
			const headers = await this._client.getJsonHeaders();
			const response = await this._client.fetchWithAuth(serviceUrl, async () => ({
				headers,
			}));
			if (response.ok) {
				const body: any = await response.json().catch(() => null);
				if (body && Array.isArray(body.value)) {
					return body.value.map((item: any) => String(item.name));
				}
			}
			if (!response.ok) {
				log.error('creatio.metadata.list_entity_sets.error', {
					url: serviceUrl,
					status: response.status,
				});
			}
		} catch (error: any) {
			log.error('creatio.metadata.list_entity_sets.error', {
				url: `${odataRoot(this._client.normalizedBaseUrl)}/`,
				error: String(error?.message ?? error),
			});
		}
		return null;
	}

	/** Build (once per parsed document) the entitySet→entityType and typeName→typeNode lookups on the
	 *  document, so describeEntity is O(1) instead of two O(N) scans over the entire EDMX per call. */
	private _ensureIndexes(doc: MetadataDoc): void {
		if (doc.entityTypeBySet && doc.typeNodeByName) {
			return;
		}
		const metadata = this._getParsedMetadata(doc);
		const schemas = this._extractSchemas(metadata);
		const bySet = new Map<string, string>();
		const byType = new Map<string, any>();
		for (const schema of schemas) {
			for (const container of this._arrayify<any>(schema.EntityContainer)) {
				for (const set of this._arrayify<any>(container.EntitySet)) {
					const name = set?.['@_Name'];
					if (name) {
						bySet.set(String(name), String(set?.['@_EntityType'] ?? ''));
					}
				}
			}
			for (const type of this._arrayify<any>(schema.EntityType)) {
				const name = type?.['@_Name'];
				if (name) {
					byType.set(String(name), type);
				}
			}
		}
		doc.entityTypeBySet = bySet;
		doc.typeNodeByName = byType;
	}

	private async _getEntitySetsFromMetadata(): Promise<string[]> {
		const doc = await this._getDoc();
		this._ensureIndexes(doc);
		return Array.from(doc.entityTypeBySet!.keys());
	}

	private _parseEntityProperties(entityTypeNode: any): {
		key: string[];
		properties: Array<{
			name: string;
			type: string;
			nullable?: boolean;
		}>;
	} {
		const keyRefs = this._arrayify<any>(entityTypeNode.Key?.PropertyRef);
		const key = keyRefs.map((ref) => String(ref?.['@_Name'] ?? '')).filter(Boolean) as string[];
		const propertyNodes = this._arrayify<any>(entityTypeNode.Property);
		const properties = propertyNodes.map((prop) => {
			const name = String(prop?.['@_Name'] ?? '');
			const type = String(prop?.['@_Type'] ?? '');
			const result: {
				name: string;
				type: string;
				nullable?: boolean;
			} = { name, type };
			if (Object.prototype.hasOwnProperty.call(prop, '@_Nullable')) {
				result.nullable = String(prop['@_Nullable']) === 'true';
			}
			return result;
		});
		return { key, properties };
	}

	public async listEntitySets(): Promise<string[]> {
		const baseUrl = this._client.normalizedBaseUrl;
		const version = await this._version();
		return this._entitySets.getOrLoad(baseUrl, version, async () => {
			const serviceSets = await this._tryGetEntitySetsFromService();
			return serviceSets ?? (await this._getEntitySetsFromMetadata());
		});
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		const doc = await this._getDoc();
		this._ensureIndexes(doc);
		const fullType = doc.entityTypeBySet!.get(entitySet) ?? '';
		if (!fullType) {
			const error = `entity_not_found:${entitySet}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const typeName = fullType.split('.').pop()!;
		const entityTypeNode = doc.typeNodeByName!.get(typeName);
		if (!entityTypeNode) {
			const error = `entity_type_not_found:${typeName}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const { key, properties } = this._parseEntityProperties(entityTypeNode);
		return { entitySet, entityType: typeName, key, properties };
	}
}
