import log from '../../../log';
import {
	ConfigurationCaller,
	ConfigurationCallResult,
	SysSettingReader,
	hasNonEmptySetting,
} from '../creatio-rest';

// Re-export the shared contracts so existing importers/tests of this module keep working.
export type {
	ConfigurationCaller,
	ConfigurationCallRequest,
	ConfigurationCallResult,
	ConfigurationHttpMethod,
	SysSettingReader,
} from '../creatio-rest';

/**
 * DataForge access layer.
 *
 * Single responsibility: build correct requests against the Creatio-hosted
 * DataForge REST services and expose the read/maintenance operations plus an
 * availability probe. It knows nothing about MCP tool registration.
 *
 * The DataForge WCF services use `[WebInvoke(BodyStyle = Wrapped)]`, so each
 * single-parameter method expects its DTO wrapped under a top-level `request`.
 */

export interface SimilarTablesQuery {
	query: string;
	limit?: number | undefined;
}

export interface TableRelationshipsQuery {
	sourceTable: string;
	targetTable: string;
	limit?: number | undefined;
	bidirectional?: boolean | undefined;
	skipDetails?: boolean | undefined;
}

export interface LookupValuesQuery {
	query: string;
	schemaName?: string | undefined;
	limit?: number | undefined;
}

const READ_SERVICE = 'DataForgeSchemaReadService';
const MAINTENANCE_SERVICE = 'DataForgeMaintenanceService';
const SERVICE_URL_SETTING = 'DataForgeServiceUrl';

export class DataForgeClient {
	private readonly _configuration: ConfigurationCaller;
	private readonly _sysSettings: SysSettingReader;

	constructor(configuration: ConfigurationCaller, sysSettings: SysSettingReader) {
		this._configuration = configuration;
		this._sysSettings = sysSettings;
	}

	/**
	 * Whether DataForge is configured on this environment. Gated on a non-empty
	 * `DataForgeServiceUrl`, mirroring the server-side `IsDataForgeEnabled` check.
	 * Probe failures are treated as "disabled" so callers degrade gracefully.
	 */
	public async isEnabled(): Promise<boolean> {
		try {
			const response = await this._sysSettings.queryValues([SERVICE_URL_SETTING]);
			return hasNonEmptySetting(response, SERVICE_URL_SETTING);
		} catch (err) {
			log.warn('dataforge.probe.failed', { error: String(err) });
			return false;
		}
	}

	public getSimilarTableNames(q: SimilarTablesQuery): Promise<ConfigurationCallResult> {
		return this._read('GetSimilarTableNames', { query: q.query, limit: q.limit });
	}

	public getTableDetails(q: SimilarTablesQuery): Promise<ConfigurationCallResult> {
		return this._read('GetTableDetails', { query: q.query, limit: q.limit });
	}

	public getTableRelationships(q: TableRelationshipsQuery): Promise<ConfigurationCallResult> {
		return this._read('GetTableRelationships', {
			sourceTable: q.sourceTable,
			targetTable: q.targetTable,
			limit: q.limit,
			bidirectional: q.bidirectional,
			skipDetails: q.skipDetails,
		});
	}

	public getLookupValues(q: LookupValuesQuery): Promise<ConfigurationCallResult> {
		return this._read('GetLookupValues', {
			query: q.query,
			schemaName: q.schemaName,
			limit: q.limit,
		});
	}

	public getTableColumns(tableName: string): Promise<ConfigurationCallResult> {
		return this._read('GetTableColumnsDetails', { tableName });
	}

	public getServiceStatus(): Promise<ConfigurationCallResult> {
		return this._configuration.call({
			service: MAINTENANCE_SERVICE,
			method: 'GetServiceStatus',
			httpMethod: 'POST',
			body: {},
		});
	}

	/**
	 * Column details for `describe-entity` routing: returns the response body when
	 * DataForge answers successfully, or `null` so the caller can fall back to
	 * OData metadata. Per-call resilience only — a single miss or error never
	 * disables DataForge globally (that verdict is owned by {@link isEnabled}).
	 */
	public async getColumnsOrNull(tableName: string): Promise<unknown | null> {
		try {
			const { body } = await this.getTableColumns(tableName);
			const result = this._unwrapResult(body);
			if (this._isFailure(result)) {
				log.info('dataforge.describe-entity.fallback', {
					reason: this._errorCode(result) ?? 'success_false',
				});
				return null;
			}
			return result ?? null;
		} catch (err) {
			log.warn('dataforge.describe-entity.error', { error: String(err) });
			return null;
		}
	}

	private _read(
		method: string,
		request: Record<string, unknown>,
	): Promise<ConfigurationCallResult> {
		return this._configuration.call({
			service: READ_SERVICE,
			method,
			httpMethod: 'POST',
			body: { request: this._omitUndefined(request) },
		});
	}

	/**
	 * The configuration REST services use WCF `BodyStyle = Wrapped`, so a response
	 * is nested under a single `<Method>Result` key (e.g. `GetTableColumnsDetailsResult`).
	 * Unwrap it so failure detection and the returned payload see the actual response.
	 */
	private _unwrapResult(body: unknown): unknown {
		if (body && typeof body === 'object' && !Array.isArray(body)) {
			const keys = Object.keys(body as object);
			if (keys.length === 1 && keys[0]!.endsWith('Result')) {
				return (body as Record<string, unknown>)[keys[0]!];
			}
		}
		return body;
	}

	/** Creatio serializes `BaseResponse.Success` as camelCase `success`; tolerate both. */
	private _isFailure(result: unknown): boolean {
		if (!result || typeof result !== 'object') {
			return false;
		}
		const r = result as { success?: boolean; Success?: boolean };
		return r.success === false || r.Success === false;
	}

	private _errorCode(result: unknown): string | undefined {
		const r = result as {
			errorInfo?: { errorCode?: string; ErrorCode?: string };
			ErrorInfo?: { errorCode?: string; ErrorCode?: string };
		} | null;
		const info = r?.errorInfo ?? r?.ErrorInfo;
		return info?.errorCode ?? info?.ErrorCode;
	}

	private _omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
		return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
	}
}
