import type { CreatioClient, CreatioClientConfig } from './client';

const DEFAULT_JSON_HEADERS = {
	'Content-Type': 'application/json',
	Accept: 'application/json;odata.metadata=minimal',
} as const;

type CookieKV = { name: string; value: string };

function parseSetCookie(setCookie: string[]): CookieKV[] {
	const out: CookieKV[] = [];
	for (const raw of setCookie || []) {
		const first = raw.split(';')[0]?.trim();
		if (!first) continue;
		const idx = first.indexOf('=');
		if (idx > 0) {
			out.push({ name: first.slice(0, idx), value: first.slice(idx + 1) });
		}
	}
	return out;
}

export class ODataCreatioClient implements CreatioClient {
	private cookieHeader?: string;
	private bpmcsrf?: string;

	constructor(
		private readonly _config: CreatioClientConfig & { login: string; password: string },
	) {}

	private async ensureSession() {
		if (this.cookieHeader) return;

		const url = `${this._config.baseUrl.replace(/\/$/, '')}/ServiceModel/AuthService.svc/Login`;
		const body = JSON.stringify({
			UserName: this._config.login,
			UserPassword: this._config.password,
		});

		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			redirect: 'manual',
		});

		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`auth_failed:${res.status} ${t}`);
		}

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

	private async jsonHeaders(): Promise<Record<string, string>> {
		await this.ensureSession();
		const h: Record<string, string> = {
			...DEFAULT_JSON_HEADERS,
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

	public async read(entity: string, filter?: string, select?: string[], top?: number) {
		const qs: string[] = [];
		if (filter) qs.push(`$filter=${encodeURIComponent(filter)}`);
		if (select && select.length) qs.push(`$select=${encodeURIComponent(select.join(','))}`);
		if (top) qs.push(`$top=${top}`);

		const url = this._entityUrl(entity) + this._query(qs);
		const headers = await this.jsonHeaders();
		const body = await this._fetchJson(url, { headers });

		if (body && typeof body === 'object' && 'value' in body) return (body as any).value;
		return body;
	}

	public async create(entity: string, data: any) {
		const url = this._entityUrl(entity);
		const headers = await this.jsonHeaders();
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`odata_create_failed:${res.status} ${t}`);
		}
		return res.json().catch(() => ({}));
	}

	public async update(entity: string, id: string, data: any) {
		const url = `${this._entityUrl(entity)}(${this._formatKey(id)})`;
		const headers = await this.jsonHeaders();
		const res = await fetch(url, {
			method: 'PATCH',
			headers,
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`odata_update_failed:${res.status} ${t}`);
		}
		return res.text();
	}

	public async delete(entity: string, id: string) {
		const url = `${this._entityUrl(entity)}(${this._formatKey(id)})`;
		const headers = await this.jsonHeaders();
		const res = await fetch(url, {
			method: 'DELETE',
			headers,
		});
		if (!res.ok) {
			const t = await res.text().catch(() => '');
			throw new Error(`odata_delete_failed:${res.status} ${t}`);
		}
		return res.text();
	}

	public async listEntitySets(): Promise<string[]> {
		const url = `${this._root()}/`;
		const headers = await this.jsonHeaders();
		const res = await fetch(url, { headers });
		if (!res.ok) throw new Error(`odata_service_doc_failed:${res.status}`);
		const body: any = await res.json().catch(() => null);

		if (body && Array.isArray(body.value)) {
			return body.value.map((x: any) => String(x.name));
		}

		const meta = await (await fetch(`${this._root()}/$metadata`, { headers })).text();
		const names = Array.from(meta.matchAll(/<EntitySet\s+Name="([^"]+)"/g))
			.map((m) => m[1])
			.filter(Boolean) as string[];
		return names;
	}

	public async describeEntity(entitySet: string): Promise<{
		entitySet: string;
		entityType: string;
		key: string[];
		properties: { name: string; type: string; nullable?: boolean }[];
	}> {
		const headers = await this.jsonHeaders();
		const xml = await (await fetch(`${this._root()}/$metadata`, { headers })).text();

		const setMatch = new RegExp(
			`<EntitySet\\s+Name="${entitySet}"\\s+EntityType="([^"]+)"`,
		).exec(xml);
		if (!setMatch) throw new Error(`entity_not_found:${entitySet}`);
		const fullType = setMatch[1];
		if (!fullType) throw new Error(`entity_not_found:${entitySet}`);
		const typeName = fullType.split('.').pop()!;

		const typeBlockMatch = new RegExp(
			`<EntityType\\s+Name="${typeName}"[\\s\\S]*?<\\/EntityType>`,
		).exec(xml);
		const block = typeBlockMatch?.[0] ?? '';

		const key = Array.from(block.matchAll(/<PropertyRef\s+Name="([^\"]+)"/g))
			.map((m) => m[1])
			.filter(Boolean) as string[];

		const props = Array.from(
			block.matchAll(
				/<Property\s+Name="([^\"]+)"\s+Type="([^\"]+)"(?:[^>]*Nullable="(true|false)")?/g,
			),
		).map((m) => {
			const item: { name: string; type: string; nullable?: boolean } = {
				name: m[1] ?? '',
				type: m[2] ?? '',
			};
			if (m[3]) item.nullable = m[3] === 'true';
			return item;
		});

		return { entitySet, entityType: typeName, key, properties: props };
	}
}
