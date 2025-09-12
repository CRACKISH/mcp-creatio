import { HttpServer, Server } from './server';
import { ODataCreatioClient } from './creatio';
import log from './log';
let _httpInstance: HttpServer | undefined;

async function main() {
	log.appStart({ env: { node: process.version, port: process.env.PORT } });
	const baseUrl = process.env.CREATIO_BASE_URL;
	if (!baseUrl) {
		throw new Error('Environment variable CREATIO_BASE_URL is required but not set');
	}
	const login = process.env.CREATIO_LOGIN;
	const password = process.env.CREATIO_PASSWORD;
	if (!login || !password) {
		throw new Error(
			'Environment variables CREATIO_LOGIN and CREATIO_PASSWORD are required but not set',
		);
	}
	const client = new ODataCreatioClient({
		baseUrl,
		login,
		password,
	});
	const server = new Server(client);
	const http = new HttpServer(server);
	_httpInstance = http;
	const port = Number(process.env.PORT || 3000);
	await http.start(port);
}

let shuttingDown = false;

async function shutdown(signal?: string) {
	if (shuttingDown) return;
	shuttingDown = true;
	try {
		log.appStop({ reason: signal || 'shutdown' });
		if (_httpInstance) await _httpInstance.stop();
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
