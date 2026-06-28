import { XMLParser } from 'fast-xml-parser';

import log from '../../../log';
import { EntitySchemaDescription } from '../../contracts';
import { CreatioHttpClient } from '../http-client';
import { SchemaFreshnessGate } from '../schema-freshness-gate';

import { odataRoot } from './odata-routes';

export class ODataMetadataStore {
	private static readonly METADATA_TTL_MS = 30 * 60 * 1000;
	private readonly _client: CreatioHttpClient;
	private readonly _freshness: SchemaFreshnessGate | undefined;
	private _metadataXml?: string;
	private _metadataParsed?: any;
	private _metadataFetchedAt = 0;
	private _entitySetsCache?: string[];
	private _entitySetsFetchedAt = 0;
	// The base URL + freshness version the cached document/list were fetched under. A change in
	// either (a different tenant via the gateway override, or a data-model change) invalidates the
	// single-slot cache. Single-slot is intentional: per-tenant pooling is the multitenancy epic;
	// here correctness (never serve another tenant's / a stale model's metadata) is what matters.
	private _metadataBaseUrl?: string;
	private _metadataVersion?: string;
	private _entitySetsBaseUrl?: string;
	private _entitySetsVersion?: string;
	// Built once per parsed-metadata document so describeEntity is O(1) instead of two O(N) scans
	// over the entire (hundreds-to-thousands of types) Creatio EDMX on every call.
	private _entityTypeBySet: Map<string, string> | undefined;
	private _typeNodeByName: Map<string, any> | undefined;

	constructor(client: CreatioHttpClient, freshness?: SchemaFreshnessGate) {
		this._client = client;
		this._freshness = freshness;
	}

	private _isFresh(fetchedAt: number): boolean {
		return Date.now() - fetchedAt < ODataMetadataStore.METADATA_TTL_MS;
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

	private async _getMetadataXml(): Promise<string> {
		const baseUrl = this._client.normalizedBaseUrl;
		const version = await this._version();
		if (
			this._metadataXml &&
			this._metadataBaseUrl === baseUrl &&
			this._metadataVersion === version &&
			this._isFresh(this._metadataFetchedAt)
		) {
			return this._metadataXml;
		}
		const headers = await this._client.getXmlHeaders();
		const metadataUrl = `${odataRoot(baseUrl)}/$metadata`;
		const xmlContent = await this._client.fetchText(metadataUrl, async () => ({ headers }));
		this._metadataXml = xmlContent;
		this._metadataParsed = undefined; // force re-parse against the refreshed document
		this._entityTypeBySet = undefined; // and rebuild the lookup indexes
		this._typeNodeByName = undefined;
		this._metadataBaseUrl = baseUrl;
		this._metadataVersion = version;
		this._metadataFetchedAt = Date.now();
		return this._metadataXml;
	}

	private async _getParsedMetadata(): Promise<any> {
		const xmlContent = await this._getMetadataXml();
		if (this._metadataParsed) {
			return this._metadataParsed;
		}
		const parser = new XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_',
		});
		this._metadataParsed = parser.parse(xmlContent);
		return this._metadataParsed;
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

	/** Build (once per parsed document) the entitySet→entityType and typeName→typeNode lookups.
	 *  Always goes through {@link _getParsedMetadata} first so the TTL refresh runs (and nulls the
	 *  indexes on a refetch); only the index build itself is cached. */
	private async _ensureIndexes(): Promise<void> {
		const metadata = await this._getParsedMetadata();
		if (this._entityTypeBySet && this._typeNodeByName) {
			return;
		}
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
		this._entityTypeBySet = bySet;
		this._typeNodeByName = byType;
	}

	private async _getEntitySetsFromMetadata(): Promise<string[]> {
		await this._ensureIndexes();
		return Array.from(this._entityTypeBySet!.keys());
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
		if (
			this._entitySetsCache &&
			this._entitySetsBaseUrl === baseUrl &&
			this._entitySetsVersion === version &&
			this._isFresh(this._entitySetsFetchedAt)
		) {
			return this._entitySetsCache;
		}
		const serviceSets = await this._tryGetEntitySetsFromService();
		const result = serviceSets ?? (await this._getEntitySetsFromMetadata());
		this._entitySetsCache = result;
		this._entitySetsBaseUrl = baseUrl;
		this._entitySetsVersion = version;
		this._entitySetsFetchedAt = Date.now();
		return result;
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		await this._ensureIndexes();
		const fullType = this._entityTypeBySet!.get(entitySet) ?? '';
		if (!fullType) {
			const error = `entity_not_found:${entitySet}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const typeName = fullType.split('.').pop()!;
		const entityTypeNode = this._typeNodeByName!.get(typeName);
		if (!entityTypeNode) {
			const error = `entity_type_not_found:${typeName}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const { key, properties } = this._parseEntityProperties(entityTypeNode);
		return { entitySet, entityType: typeName, key, properties };
	}
}
