export type LogLevel = 'info' | 'warn' | 'error';
export type LogVerbosity = LogLevel | 'silent';
export type CreatioAuthKind = 'legacy' | 'oauth2' | 'oauth2_code';

export interface LogConfig {
	level?: LogLevel;
}

let _correlationId: string | undefined;
let _stderrOnly = false;

function resolveLogVerbosity(): LogVerbosity {
	const raw = (process.env.MCP_CREATIO_LOG_LEVEL || 'silent').toLowerCase();
	if (raw === 'info') {
		return 'info';
	}
	if (raw === 'warn' || raw === 'warning') {
		return 'warn';
	}
	if (raw === 'error') {
		return 'error';
	}
	return 'silent';
}

function shouldLog(level: LogLevel): boolean {
	const verbosity = resolveLogVerbosity();
	if (verbosity === 'silent') {
		return false;
	}
	if (verbosity === 'error') {
		return level === 'error';
	}
	if (verbosity === 'warn') {
		return level === 'warn' || level === 'error';
	}
	return true;
}

export function setCorrelationId(correlationId: string) {
	_correlationId = correlationId;
}

export function getCorrelationId(): string | undefined {
	return _correlationId;
}

export function clearCorrelationId() {
	_correlationId = undefined;
}

function timestamp() {
	return new Date().toISOString();
}

function output(level: LogLevel, msg: string, meta?: Record<string, any>) {
	if (!shouldLog(level)) {
		return;
	}
	const entry: any = { ts: timestamp(), level, msg };
	if (_correlationId) {
		entry.correlationId = _correlationId;
	}
	if (meta && Object.keys(meta).length) {
		entry.meta = meta;
	}
	const line = JSON.stringify(entry);
	if (_stderrOnly) {
		process.stderr.write(line + '\n');
		return;
	}
	if (level === 'error') {
		console.error(line);
	} else if (level === 'warn') {
		console.warn(line);
	} else {
		console.log(line);
	}
}

export function useStderrOnlyLogs() {
	_stderrOnly = true;
}

export function info(msg: string, meta?: Record<string, any>) {
	output('info', msg, meta);
}
export function warn(msg: string, meta?: Record<string, any>) {
	output('warn', msg, meta);
}
export function error(msg: string, meta?: Record<string, any>) {
	output('error', msg, meta);
}
export function appStart(meta?: Record<string, any>) {
	info('app.start', meta);
}
export function appStop(meta?: Record<string, any>) {
	info('app.stop', meta);
}
export function serverStart(name?: string, version?: string, meta?: Record<string, any>) {
	info('mcp.server.start', { name, version, ...meta });
}
export function serverStop(name?: string, version?: string, meta?: Record<string, any>) {
	info('mcp.server.stop', { name, version, ...meta });
}
export function httpStart(port: number, meta?: Record<string, any>) {
	info('http.server.start', { port, ...meta });
}
export function httpStop(port: number, meta?: Record<string, any>) {
	info('http.server.stop', { port, ...meta });
}
export function sessionConnect(sessionId: string, ip?: string, meta?: Record<string, any>) {
	info('session.connect', { sessionId, ip, ...meta });
}
export function sessionDisconnect(sessionId: string, ip?: string, meta?: Record<string, any>) {
	info('session.disconnect', { sessionId, ip, ...meta });
}
export function creatioAuthStart(baseUrl: string, authKind?: CreatioAuthKind) {
	info('creatio.auth.start', { baseUrl, authKind });
}
export function creatioAuthOk(baseUrl: string, authKind?: CreatioAuthKind) {
	info('creatio.auth.ok', { baseUrl, authKind });
}
export function creatioAuthFailed(baseUrl: string, error: string, authKind?: CreatioAuthKind) {
	warn('creatio.auth.failed', { baseUrl, error, authKind });
}
export function httpRequest(method: string, url: string, meta?: Record<string, any>) {
	info('http.request', { method, url, ...meta });
}
export function httpResponse(
	method: string,
	url: string,
	status: number,
	duration?: number,
	meta?: Record<string, any>,
) {
	info('http.response', { method, url, status, duration, ...meta });
}
export function httpError(
	method: string,
	url: string,
	errorMsg: string,
	meta?: Record<string, any>,
) {
	error('http.error', { method, url, error: errorMsg, ...meta });
}
export function logOperation(
	operation: string,
	duration: number,
	success: boolean,
	meta?: Record<string, any>,
) {
	info(`operation.${success ? 'success' : 'failed'}`, {
		operation,
		duration,
		...meta,
	});
}

export default {
	info,
	warn,
	error,
	useStderrOnlyLogs,
	appStart,
	appStop,
	serverStart,
	serverStop,
	httpStart,
	httpStop,
	sessionConnect,
	sessionDisconnect,
	creatioAuthStart,
	creatioAuthOk,
	creatioAuthFailed,
	httpRequest,
	httpResponse,
	httpError,
	logOperation,
	setCorrelationId,
	getCorrelationId,
	clearCorrelationId,
};
