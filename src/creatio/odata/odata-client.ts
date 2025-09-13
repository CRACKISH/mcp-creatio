import { XMLParser } from 'fast-xml-parser';

import log from '../../log';
import { parseSetCookie } from '../../utils';
import { CreatioClient, CreatioClientConfig } from '../client';

const DEFAULT_JSON_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json;odata.metadata=minimal',
} as const;

export class ODataCreatioClient implements CreatioClient {
	private cookieHeader?: string;
	private bpmcsrf?: string;
	private _metadataXml?: string;
	private _metadataParsed?: any;

	constructor(
		private readonly _config: CreatioClientConfig & { login: string; password: string },
	) {}

	private async _ensureSession() {
		if (this.cookieHeader) return;

		const url = `${this._config.baseUrl.replace(/\/$/, '')}/ServiceModel/AuthService.svc/Login`;
		const body = JSON.stringify({
			UserName: this._config.login,
			UserPassword: this._config.password,
		});

		log.creatioAuthStart(this._config.baseUrl);
		const t0 = Date.now();
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			redirect: 'manual',
		});

		if (!res.ok) {
			const t = await res.text().catch(() => '');
			log.creatioAuthFailed(this._config.baseUrl, `${res.status} ${t}`);
			throw new Error(`auth_failed:${res.status} ${t}`);
		}
		log.creatioAuthOk(this._config.baseUrl);

		const setCookie = (res.headers.getSetCookie?.() ??
			(res.headers as any).raw?.()['set-cookie'] ??
			[]) as string[];

		const pairs = parseSetCookie(setCookie);
		if (!pairs.length) {
			throw new Error('auth_failed:no_set_cookie');
		}

		this.cookieHeader = pairs.map((c) => `${c.name}=${c.value}`).join('; ');
		const csrf = pairs.find((c) => c.name.toUpperCase() === 'BPMCSRF')?.value;
		if (csrf) this.bpmcsrf = csrf;
	}

	private async _jsonHeaders(): Promise<Record<string, string>> {
		await this._ensureSession();
		const h: Record<string, string> = {
			...DEFAULT_JSON_HEADERS,
			ForceUseSession: 'true',
			Cookie: this.cookieHeader!,
		};
		if (this.bpmcsrf) h['BPMCSRF'] = this.bpmcsrf;
		return h;
	}

	private async _xmlHeaders(): Promise<Record<string, string>> {
		await this._ensureSession();
		const h: Record<string, string> = {
			Accept: 'application/xml',
			ForceUseSession: 'true',
			Cookie: this.cookieHeader!,
		};
		if (this.bpmcsrf) h['BPMCSRF'] = this.bpmcsrf;
		return h;
	}

	private _formatKey(id: string) {
		const guidRe =
			/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
		const numericRe = /^\d+$/;
		if (numericRe.test(id) || guidRe.test(id)) return id;
		return `'${id.replace(/'/g, "''")}'`;
	}

	private _root() {
		return `${this._config.baseUrl.replace(/\/$/, '')}/0/odata`;
	}

	private _entityUrl(entity: string) {
		return `${this._root()}/${entity}`;
	}

	private _query(params: string[]) {
		return params.length ? `?${params.join('&')}` : '';
	}

	private async _fetchJson(url: string, init?: RequestInit) {
		const res = await fetch(url, init);
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`odata_error:${res.status} ${text}`);
		}
		return res.json();
	}

	private _arrify<T>(x: T | T[] | undefined | null): T[] {
		if (x == null) return [];
		return Array.isArray(x) ? x : [x];
	}

	private async _getMetadataXml(): Promise<string> {
		if (this._metadataXml) return this._metadataXml;
		const headers = await this._xmlHeaders();
		const res = await fetch(`${this._root()}/$metadata`, { headers });
		if (!res.ok) {
			throw new Error(`odata_metadata_failed:${res.status}`);
		}
		this._metadataXml = await res.text();
		return this._metadataXml;
	}

	private async _getParsedMetadata(): Promise<any> {
		if (this._metadataParsed) return this._metadataParsed;
		const xml = await this._getMetadataXml();
		const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
		this._metadataParsed = parser.parse(xml);
		return this._metadataParsed;
	}

	public async read(entity: string, filter?: string, select?: string[], top?: number) {
		const qs: string[] = [];
		if (filter) qs.push(`$filter=${encodeURIComponent(filter)}`);
		if (select && select.length) qs.push(`$select=${encodeURIComponent(select.join(','))}`);
		if (top) qs.push(`$top=${top}`);

		const url = this._entityUrl(entity) + this._query(qs);
		const headers = await this._jsonHeaders();
		const t0 = Date.now();
		try {
			const body = await this._fetchJson(url, { headers });
			const val =
				body && typeof body === 'object' && 'value' in body ? (body as any).value : body;
			return val;
		} catch (e: any) {
			log.error('odata.read.error', { entity, url, error: String(e?.message ?? e) });
			throw e;
		}
	}

	public async create(entity: string, data: any) {
		const url = this._entityUrl(entity);
		const headers = await this._jsonHeaders();
		const t0 = Date.now();
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			log.error('odata.create.error', { entity, url, status: res.status, error: t });
			throw new Error(`odata_create_failed:${res.status} ${t}`);
		}
		return res.json().catch(() => ({}));
	}

	public async update(entity: string, id: string, data: any) {
		const url = `${this._entityUrl(entity)}(${this._formatKey(id)})`;
		const headers = await this._jsonHeaders();
		const t0 = Date.now();
		const res = await fetch(url, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			log.error('odata.update.error', { entity, url, status: res.status, error: t });
			throw new Error(`odata_update_failed:${res.status} ${t}`);
		}
		return res.text();
	}

	public async delete(entity: string, id: string) {
		const url = `${this._entityUrl(entity)}(${this._formatKey(id)})`;
		const headers = await this._jsonHeaders();
		const t0 = Date.now();
		const res = await fetch(url, {
			method: 'DELETE',
			headers,
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			log.error('odata.delete.error', { entity, url, status: res.status, error: t });
			throw new Error(`odata_delete_failed:${res.status} ${t}`);
		}
		return res.text();
	}

	public async listEntitySets(): Promise<string[]> {
		try {
			const url = `${this._root()}/`;
			const headers = await this._jsonHeaders();
			const t0 = Date.now();
			const res = await fetch(url, { headers });
			if (res.ok) {
				const body: any = await res.json().catch(() => null);
				if (body && Array.isArray(body.value)) {
					return body.value.map((x: any) => String(x.name));
				}
			}
			// non-OK HTTP status
			if (!res.ok) {
				log.error('odata.list-entity-sets.error', { url, status: res.status });
			}
			// if unexpected shape - fallback to metadata parse
		} catch (e: any) {
			// record error then fallback to metadata parse
			log.error('odata.list-entity-sets.error', {
				url: `${this._root()}/`,
				error: String(e?.message ?? e),
			});
		}

		const md = await this._getParsedMetadata();
		const ds = md['edmx:Edmx']?.['edmx:DataServices'];
		const schemas = this._arrify<any>(ds?.Schema);
		const allSets: string[] = [];
		for (const schema of schemas) {
			const containers = this._arrify<any>(schema.EntityContainer);
			for (const c of containers) {
				const sets = this._arrify<any>(c.EntitySet);
				for (const s of sets) {
					const name = s?.['@_Name'];
					if (name) allSets.push(String(name));
				}
			}
		}
		return Array.from(new Set(allSets));
	}

	public async describeEntity(entitySet: string): Promise<{
		entitySet: string;
		entityType: string;
		key: string[];
		properties: { name: string; type: string; nullable?: boolean }[];
	}> {
		const t0 = Date.now();
		const md = await this._getParsedMetadata();
		const ds = md['edmx:Edmx']?.['edmx:DataServices'];
		const schemas = this._arrify<any>(ds?.Schema);

		let fullType = '' as string;
		for (const schema of schemas) {
			const containers = this._arrify<any>(schema.EntityContainer);
			for (const c of containers) {
				const sets = this._arrify<any>(c.EntitySet);
				for (const s of sets) {
					if (s?.['@_Name'] === entitySet) {
						fullType = String(s?.['@_EntityType'] ?? '');
						break;
					}
				}
			}
		}
		if (!fullType) {
			log.error('odata.describe-entity.error', {
				entitySet,
				error: `entity_not_found:${entitySet}`,
			});
			throw new Error(`entity_not_found:${entitySet}`);
		}
		const typeName = fullType.split('.').pop()!;

		let entityTypeNode: any | undefined;
		for (const schema of schemas) {
			const types = this._arrify<any>(schema.EntityType);
			for (const t of types) {
				if (t?.['@_Name'] === typeName) {
					entityTypeNode = t;
					break;
				}
			}
			if (entityTypeNode) break;
		}
		if (!entityTypeNode) {
			log.error('odata.describe-entity.error', {
				entitySet,
				error: `entity_type_not_found:${typeName}`,
			});
			throw new Error(`entity_type_not_found:${typeName}`);
		}

		const keyRefs = this._arrify<any>(entityTypeNode.Key?.PropertyRef);
		const key = keyRefs.map((r) => String(r?.['@_Name'] ?? '')).filter(Boolean) as string[];

		const propsNodes = this._arrify<any>(entityTypeNode.Property);
		const properties = propsNodes.map((p) => {
			const name = String(p?.['@_Name'] ?? '');
			const type = String(p?.['@_Type'] ?? '');
			const item: { name: string; type: string; nullable?: boolean } = { name, type };
			if (Object.prototype.hasOwnProperty.call(p, '@_Nullable')) {
				item.nullable = String(p['@_Nullable']) === 'true';
			}
			return item;
		});

		// keep local duration for potential future use; no noisy logs
		return { entitySet, entityType: typeName, key, properties };
	}
}
