import { getCreatioClientConfig } from './config-builder';
import { HTTP_MCP_PORT } from './consts';
import { CreatioEngineManager, CreatioServiceContext } from './creatio';
import log from './log';
import { HttpServer, Server } from './server';
import { envBool } from './utils';

let _httpInstance: HttpServer | undefined;

async function main() {
	log.appStart({ env: { node: process.version, HTTP_MCP_PORT } });
	const cfg = getCreatioClientConfig();
	const provider = new CreatioServiceContext(cfg);
	const engines = new CreatioEngineManager(provider);
	const server = new Server(engines, { readonlyMode: envBool('READONLY_MODE', false) });
	const http = new HttpServer(server);
	_httpInstance = http;
	await http.start(HTTP_MCP_PORT);
}

let shuttingDown = false;

async function shutdown(signal?: string) {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	try {
		log.appStop({ reason: signal || 'shutdown' });
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
