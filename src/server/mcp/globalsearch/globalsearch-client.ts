import log from '../../../log';
import { ConfigurationCaller, SysSettingReader, hasNonEmptySetting } from '../creatio-rest';

/**
 * Global Search access layer.
 *
 * Single responsibility: call the Creatio-hosted `GlobalSearchService` (which
 * proxies Elasticsearch) and expose an availability probe. Knows nothing about
 * MCP tool registration.
 *
 * `GlobalSearchService.Search` uses `[WebInvoke(BodyStyle = Wrapped)]` with
 * several primitive parameters, so the request body is a FLAT object with one
 * top-level key per parameter (unlike DataForge's single wrapped `request`).
 */

export interface GlobalSearchQuery {
	/** Free-text search string. */
	query: string;
	/** Optional comma-separated entity schema names to restrict the search to. */
	type?: string | undefined;
	/** Optional current section entity name (UI context). */
	sectionEntityName?: string | undefined;
	/** Max records to return. */
	recordCount?: number | undefined;
	/** Pagination offset. */
	from?: number | undefined;
}

const SEARCH_SERVICE = 'GlobalSearchService';
// Either URL being set is the operator-facing signal that Global Search is wired;
// `GlobalSearchUrl` (the Elasticsearch endpoint) is the core requirement.
const SEARCH_URL_SETTING = 'GlobalSearchUrl';
const DEFAULT_RECORD_COUNT = 15;

export class GlobalSearchClient {
	private readonly _configuration: ConfigurationCaller;
	private readonly _sysSettings: SysSettingReader;

	constructor(configuration: ConfigurationCaller, sysSettings: SysSettingReader) {
		this._configuration = configuration;
		this._sysSettings = sysSettings;
	}

	/**
	 * Whether Global Search is configured on this environment. Gated on a non-empty
	 * `GlobalSearchUrl`. Note: the platform additionally requires the `GlobalSearch_V2`
	 * feature; a configured URL is the cheap operator-facing signal used to decide
	 * whether to expose the tool. Probe failures degrade to "disabled".
	 */
	public async isEnabled(): Promise<boolean> {
		try {
			const response = await this._sysSettings.queryValues([SEARCH_URL_SETTING]);
			return hasNonEmptySetting(response, SEARCH_URL_SETTING);
		} catch (err) {
			log.warn('globalsearch.probe.failed', { error: String(err) });
			return false;
		}
	}

	/**
	 * Run a global search and return a compact, UI-like result: per match the
	 * entity, record id, a display title, and the highlighted `matched` columns —
	 * plus `total`/`nextFrom` for paging. (The raw service returns every indexed
	 * column of every record as a stringified `SearchResult`; that is far too large
	 * to hand to an LLM, so we parse and project it. Use `read` with the id for the
	 * full record.)
	 */
	public async search(q: GlobalSearchQuery): Promise<unknown> {
		// `GlobalSearchService.Search(queryString, sectionEntityName, recordCount, type="", from=0)`
		// — the first three parameters have no defaults, so the WCF Wrapped body MUST
		// include them or binding fails with HTTP 400. `type` is optional; only send it
		// when filtering, mirroring the UI call.
		const body: Record<string, unknown> = {
			queryString: q.query,
			sectionEntityName: q.sectionEntityName ?? '',
			recordCount: q.recordCount ?? DEFAULT_RECORD_COUNT,
			from: q.from ?? 0,
		};
		if (q.type) {
			body.type = q.type;
		}
		const response = await this._configuration.call({
			service: SEARCH_SERVICE,
			method: 'Search',
			httpMethod: 'POST',
			body,
		});
		return this._project(response.body);
	}

	/** Parse the stringified `SearchResult` envelope and project it to a compact shape. */
	private _project(body: unknown): unknown {
		const raw = (body as { SearchResult?: unknown } | null)?.SearchResult;
		let parsed: unknown = raw;
		if (typeof raw === 'string') {
			try {
				parsed = JSON.parse(raw);
			} catch {
				return body;
			}
		}
		const p = parsed as {
			success?: boolean;
			total?: number;
			nextFrom?: number;
			took?: number;
			errorInfo?: unknown;
			data?: Array<{
				entityName?: string;
				id?: string;
				columnValues?: unknown;
				foundColumns?: unknown;
			}>;
		} | null;
		if (!p || !Array.isArray(p.data)) {
			return parsed ?? body;
		}
		return {
			success: p.success,
			total: p.total,
			nextFrom: p.nextFrom,
			took: p.took,
			errorInfo: p.errorInfo ?? null,
			results: p.data.map((r) => ({
				entityName: r.entityName,
				id: r.id,
				title: this._displayName(r.columnValues),
				matched: r.foundColumns,
			})),
		};
	}

	/** Best-effort human title from a record's column values (string or `{ displayValue }`). */
	private _displayName(columnValues: unknown): string | undefined {
		if (!columnValues || typeof columnValues !== 'object') {
			return undefined;
		}
		const cv = columnValues as Record<string, unknown>;
		for (const key of ['Name', 'Title', 'LeadName', 'BpmName', 'Subject', 'Number', 'Email']) {
			const v = cv[key];
			const s =
				typeof v === 'string'
					? v
					: v && typeof v === 'object'
						? (v as { displayValue?: unknown }).displayValue
						: undefined;
			if (typeof s === 'string' && s.trim().length > 0) {
				return s.trim();
			}
		}
		return undefined;
	}
}
