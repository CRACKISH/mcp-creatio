/**
 * Shared narrow contracts for talking to Creatio configuration REST services and
 * reading system settings. Capability clients (DataForge, Global Search, …) depend
 * on these interfaces rather than the concrete engines (Dependency Inversion).
 */

import log from '../../log';

export type ConfigurationHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ConfigurationCallRequest {
	service?: string;
	method?: string;
	/** Pre-built relative path (already safely encoded) for multi-segment routes
	 *  that service/method cannot express, e.g. `/0/rest/ToolServiceMcp/{code}/v1/mcp`. */
	rawPath?: string;
	httpMethod?: ConfigurationHttpMethod;
	body?: unknown;
	query?: Record<string, string | number | boolean>;
}

export interface ConfigurationCallResult {
	status: number;
	contentType?: string;
	body: unknown;
}

/** Narrow capability: invoke a configuration REST service method. */
export interface ConfigurationCaller {
	call(request: ConfigurationCallRequest): Promise<ConfigurationCallResult>;
}

/** Narrow capability: read system setting values. */
export interface SysSettingReader {
	queryValues(codes: string[]): Promise<{ values?: Record<string, unknown> }>;
}

/**
 * Extract a system setting's value from a QuerySysSettings response. Creatio
 * returns each setting as an object `{ code, value, ... }`; a bare value is also
 * tolerated. Returns `undefined` when absent.
 */
export function getSettingValue(
	response: { values?: Record<string, unknown> } | undefined,
	code: string,
): unknown {
	const entry = response?.values?.[code];
	return entry && typeof entry === 'object' ? (entry as { value?: unknown }).value : entry;
}

/** True when the named setting holds a non-empty string value. */
export function hasNonEmptySetting(
	response: { values?: Record<string, unknown> } | undefined,
	code: string,
): boolean {
	const value = getSettingValue(response, code);
	return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Probe whether an optional capability is configured by checking a system setting holds a non-empty
 * value (the cheap operator-facing signal both DataForge and Global Search use). Any probe failure
 * degrades to `false` so callers stay graceful. `logLabel` namespaces the warning (e.g. `dataforge`).
 */
export async function probeSettingEnabled(
	sysSettings: SysSettingReader,
	settingCode: string,
	logLabel: string,
): Promise<boolean> {
	try {
		const response = await sysSettings.queryValues([settingCode]);
		return hasNonEmptySetting(response, settingCode);
	} catch (err) {
		log.warn(`${logLabel}.probe.failed`, { error: String(err) });
		return false;
	}
}
