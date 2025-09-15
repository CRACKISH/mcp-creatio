type ODataRequestEndMeta = {
	durationMs: number;
	status?: number;
	url?: string;
	error?: string;
} & Record<string, any>;
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogConfig {
	level?: LogLevel;
}

const DEFAULT_CONFIG: Required<LogConfig> = { level: 'info' };

function timestamp() {
	return new Date().toISOString();
}

function output(level: LogLevel, msg: string, meta?: Record<string, any>) {
	const entry: any = { ts: timestamp(), level, msg };
	if (meta && Object.keys(meta).length) entry.meta = meta;
	const line = JSON.stringify(entry);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
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

export type CreatioAuthKind = 'oauth2' | 'legacy';

export function creatioAuthStart(baseUrl: string, authKind?: CreatioAuthKind) {
	info('creatio.auth.start', { baseUrl, authKind });
}

export function creatioAuthOk(baseUrl: string, authKind?: CreatioAuthKind) {
	info('creatio.auth.ok', { baseUrl, authKind });
}

export function creatioAuthFailed(baseUrl: string, error: string, authKind?: CreatioAuthKind) {
	warn('creatio.auth.failed', { baseUrl, error, authKind });
}

export default {
	info,
	warn,
	error,
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
};
