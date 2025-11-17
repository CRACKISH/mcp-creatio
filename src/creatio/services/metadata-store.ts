import { XMLParser } from 'fast-xml-parser';

import log from '../../log';
import { EntitySchemaDescription } from '../providers';

import { CreatioHttpClient } from './http-client';

export class ODataMetadataStore {
	private readonly _client: CreatioHttpClient;
	private _metadataXml?: string;
	private _metadataParsed?: any;

	constructor(client: CreatioHttpClient) {
		this._client = client;
	}

	private _arrayify<T>(value: T | T[] | undefined | null): T[] {
		if (value == null) {
			return [];
		}
		return Array.isArray(value) ? value : [value];
	}

	private async _getMetadataXml(): Promise<string> {
		if (this._metadataXml) {
			return this._metadataXml;
		}
		const headers = await this._client.getXmlHeaders();
		const metadataUrl = `${this._client.odataRoot}/$metadata`;
		const xmlContent = await this._client.fetchText(metadataUrl, async () => ({ headers }));
		this._metadataXml = xmlContent;
		return this._metadataXml;
	}

	private async _getParsedMetadata(): Promise<any> {
		if (this._metadataParsed) {
			return this._metadataParsed;
		}
		const xmlContent = await this._getMetadataXml();
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
			const serviceUrl = `${this._client.odataRoot}/`;
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
				url: `${this._client.odataRoot}/`,
				error: String(error?.message ?? error),
			});
		}
		return null;
	}

	private async _getEntitySetsFromMetadata(): Promise<string[]> {
		const metadata = await this._getParsedMetadata();
		const schemas = this._extractSchemas(metadata);
		const entitySets: string[] = [];
		for (const schema of schemas) {
			const containers = this._arrayify<any>(schema.EntityContainer);
			for (const container of containers) {
				const sets = this._arrayify<any>(container.EntitySet);
				for (const set of sets) {
					const name = set?.['@_Name'];
					if (name) {
						entitySets.push(String(name));
					}
				}
			}
		}
		return Array.from(new Set(entitySets));
	}

	private _findEntityType(schemas: any[], entitySet: string): string {
		for (const schema of schemas) {
			const containers = this._arrayify<any>(schema.EntityContainer);
			for (const container of containers) {
				const sets = this._arrayify<any>(container.EntitySet);
				for (const set of sets) {
					if (set?.['@_Name'] === entitySet) {
						return String(set?.['@_EntityType'] ?? '');
					}
				}
			}
		}
		return '';
	}

	private _findEntityTypeNode(schemas: any[], typeName: string): any {
		for (const schema of schemas) {
			const types = this._arrayify<any>(schema.EntityType);
			for (const type of types) {
				if (type?.['@_Name'] === typeName) {
					return type;
				}
			}
		}
		return undefined;
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
		const serviceSets = await this._tryGetEntitySetsFromService();
		if (serviceSets) {
			return serviceSets;
		}
		return this._getEntitySetsFromMetadata();
	}

	public async describeEntity(entitySet: string): Promise<EntitySchemaDescription> {
		const metadata = await this._getParsedMetadata();
		const schemas = this._extractSchemas(metadata);
		const fullType = this._findEntityType(schemas, entitySet);
		if (!fullType) {
			const error = `entity_not_found:${entitySet}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const typeName = fullType.split('.').pop()!;
		const entityTypeNode = this._findEntityTypeNode(schemas, typeName);
		if (!entityTypeNode) {
			const error = `entity_type_not_found:${typeName}`;
			log.error('creatio.metadata.describe_entity.error', { entitySet, error });
			throw new Error(error);
		}
		const { key, properties } = this._parseEntityProperties(entityTypeNode);
		return { entitySet, entityType: typeName, key, properties };
	}
}
