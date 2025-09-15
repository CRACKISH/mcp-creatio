import { CreatioClientAuthConfig, CreatioClientConfig, ODataCreatioClient } from './creatio';
import log from './log';
import { HttpServer, Server } from './server';
let _httpInstance: HttpServer | undefined;

function getCreatioClientConfig(): CreatioClientConfig {
	const baseUrl = process.env.CREATIO_BASE_URL;
	if (!baseUrl) {
		throw new Error('Environment variable CREATIO_BASE_URL is required but not set');
	}

	const auth = getCreatioClientAuthConfig();
	// If OAuth2 is used, propagate optional identity service base URL into the auth config
	if (auth.kind === 'oauth2') {
		const idBaseUrl = process.env.CREATIO_ID_BASE_URL;
		if (idBaseUrl) {
			auth.idBaseUrl = idBaseUrl;
		}
	}
	return { baseUrl, auth } as CreatioClientConfig;
}

export function getCreatioClientAuthConfig(): CreatioClientAuthConfig {
	const clientId = process.env.CREATIO_CLIENT_ID;
	const clientSecret = process.env.CREATIO_CLIENT_SECRET;
	if (clientId && clientSecret) {
		return { kind: 'oauth2', clientId: String(clientId), clientSecret: String(clientSecret) };
	}

	const login = process.env.CREATIO_LOGIN;
	const password = process.env.CREATIO_PASSWORD;
	if (login && password) {
		return { kind: 'legacy', login: String(login), password: String(password) };
	}

	throw new Error(
		'You must set either CREATIO_CLIENT_ID/CREATIO_CLIENT_SECRET or both CREATIO_LOGIN and CREATIO_PASSWORD environment variables',
	);
}

async function main() {
	log.appStart({ env: { node: process.version, port: process.env.PORT } });
	const client = new ODataCreatioClient(getCreatioClientConfig());
	const server = new Server(client, {
		readonly: process.env.READONLY === 'true',
	});
	const http = new HttpServer(server);
	_httpInstance = http;
	await http.start(Number(3000));
}

let shuttingDown = false;

async function shutdown(signal?: string) {
	if (shuttingDown) return;
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
