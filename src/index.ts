import { getCreatioClientConfig } from './config-builder';
import { HTTP_MCP_PORT } from './consts';
import { AuthProviderType, CreatioEngineManager, CreatioServiceContext } from './creatio';
import log from './log';
import { HttpServer, Server, SessionKeepAlive, keepAliveIntervalMs } from './server';
import { envBool } from './utils';

let _httpInstance: HttpServer | undefined;
let _keepAlive: SessionKeepAlive | undefined;

/** Single shared Creatio session exists only for legacy / client_credentials — the modes the
 *  proactive keep-alive applies to (broker/delegated/gateway are per-user / per-request). */
function isSingleSessionMode(kind: AuthProviderType): boolean {
	return kind === AuthProviderType.Legacy || kind === AuthProviderType.OAuth2;
}

async function main() {
	log.appStart({ env: { node: process.version, HTTP_MCP_PORT } });
	// Auth mode is resolved in config-builder: explicit CREATIO_MCP_AUTH_MODE, else inferred
	// (legacy/client_credentials from creds, otherwise delegated for this multi-user HTTP server).
	const cfg = getCreatioClientConfig();
	const provider = new CreatioServiceContext(cfg);
	const readonlyMode = envBool('CREATIO_MCP_READONLY', false);
	const engines = new CreatioEngineManager(provider, { readonly: readonlyMode });
	const server = new Server(engines, {
		readonlyMode,
		disableDataForge: envBool('CREATIO_MCP_DISABLE_DATAFORGE', false),
		disableGlobalSearch: envBool('CREATIO_MCP_DISABLE_GLOBAL_SEARCH', false),
	});
	const http = new HttpServer(server, cfg);
	_httpInstance = http;
	await http.start(HTTP_MCP_PORT);
	if (isSingleSessionMode(cfg.auth.kind)) {
		_keepAlive = new SessionKeepAlive(keepAliveIntervalMs(), () =>
			engines.user.getCurrentUserInfo(),
		);
		_keepAlive.start();
	}
}

let shuttingDown = false;

async function shutdown(signal?: string) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	try {
		log.appStop({ reason: signal || 'shutdown' });
		_keepAlive?.stop();
		await _httpInstance?.stop();
	} catch (err) {
		log.error('shutdown.error', { error: String(err) });
	} finally {
		process.exit(0);
	}
}

main().catch((err) => {
	log.error('startup.error', { error: String(err) });
	process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
