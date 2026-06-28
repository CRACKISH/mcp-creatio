#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getCreatioClientConfig } from './config-builder';
import { AuthProviderType, CreatioEngineManager, CreatioServiceContext } from './creatio';
import log from './log';
import { Server, SessionKeepAlive, installHttpAgent, keepAliveIntervalMs } from './server';
import { envBool } from './utils';

type CliOptions = Record<string, string>;

interface RuntimeState {
	server?: Server;
	keepAlive?: SessionKeepAlive;
}

export function printHelp(): void {
	const text = `
MCP Creatio CLI

Usage:
  mcp-creatio [options]

Options:
  --base-url <url>             Creatio base URL
  --url <url>                  Alias for --base-url
  --login <value>              Creatio login (legacy auth)
  --password <value>           Creatio password (legacy auth)
  --client-id <value>          OAuth2 client credentials client_id
  --client-secret <value>      OAuth2 client credentials client_secret
  --id-base-url <url>          Creatio Identity base URL
  --readonly <true|false>      Enable readonly mode
  --log-level <silent|error|warn|info>
                               Log verbosity (default: silent)
  -h, --help                   Show this help

Examples:
  mcp-creatio --base-url https://tenant.creatio.com --login your_login --password your_password
`.trim();
	process.stdout.write(text + '\n');
}

export function parseArgs(argv: string[]): CliOptions {
	const opts: CliOptions = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token || !token.startsWith('-')) {
			continue;
		}

		if (token === '--help' || token === '-h') {
			opts.help = 'true';
			continue;
		}

		if (!token.startsWith('--')) {
			continue;
		}

		const eqIndex = token.indexOf('=');
		if (eqIndex > 2) {
			const key = token.slice(2, eqIndex);
			const value = token.slice(eqIndex + 1);
			opts[key] = value;
			continue;
		}

		const key = token.slice(2);
		const next = argv[i + 1];
		if (next && !next.startsWith('-')) {
			opts[key] = next;
			i++;
			continue;
		}

		opts[key] = 'true';
	}
	return opts;
}

export function setEnvIfDefined(name: string, value?: string): void {
	if (typeof value === 'string' && value.length > 0) {
		process.env[name] = value;
	}
}

export function applyCliEnv(opts: CliOptions): void {
	setEnvIfDefined('CREATIO_BASE_URL', opts['base-url'] || opts.url);
	setEnvIfDefined('CREATIO_LOGIN', opts.login);
	setEnvIfDefined('CREATIO_PASSWORD', opts.password);
	setEnvIfDefined('CREATIO_CLIENT_ID', opts['client-id']);
	setEnvIfDefined('CREATIO_CLIENT_SECRET', opts['client-secret']);
	setEnvIfDefined('CREATIO_ID_BASE_URL', opts['id-base-url']);
	setEnvIfDefined('CREATIO_MCP_READONLY', opts.readonly);
	setEnvIfDefined('CREATIO_MCP_LOG_LEVEL', opts['log-level']);
}

async function startStdio(server: Server): Promise<void> {
	const mcp = server.createSessionServer();
	const transport = new StdioServerTransport();
	await mcp.connect(transport);
	// stdio uses a single-user provider (legacy/client_credentials) that carries its own
	// credentials, so the probe needs no request context here.
	server.ensureCapabilitiesProbed();
	log.info('stdio.server.start');
}

let shuttingDown = false;

async function shutdown(signal: string, state: RuntimeState): Promise<void> {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	log.appStop({ reason: signal || 'shutdown' });
	try {
		state.keepAlive?.stop();
		await state.server?.stopAll();
	} catch (err) {
		log.error('shutdown.error', { error: String(err) });
	}
}

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help === 'true') {
		printHelp();
		return;
	}

	log.useStderrOnlyLogs();
	installHttpAgent();
	applyCliEnv(opts);
	const cfg = getCreatioClientConfig();

	// stdio is a single-process, single-user transport. The multi-user HTTP auth modes
	// (delegated/gateway/broker) have no incoming web request to authenticate here.
	if (
		cfg.auth.kind === AuthProviderType.OAuth2Bearer ||
		cfg.auth.kind === AuthProviderType.Broker
	) {
		throw new Error(
			`auth_mode_requires_http_server: CREATIO_MCP_AUTH_MODE=${cfg.auth.kind === AuthProviderType.Broker ? 'broker' : 'delegated/gateway'} needs the HTTP /mcp server — use "npm start". stdio supports client-credentials or legacy auth.`,
		);
	}

	const provider = new CreatioServiceContext(cfg);
	const readonlyMode = envBool('CREATIO_MCP_READONLY', false);
	const engines = new CreatioEngineManager(provider, { readonly: readonlyMode });
	const server = new Server(engines, {
		readonlyMode,
		disableDataForge: envBool('CREATIO_MCP_DISABLE_DATAFORGE', false),
		disableGlobalSearch: envBool('CREATIO_MCP_DISABLE_GLOBAL_SEARCH', false),
	});
	// Proactive keep-alive applies only to the single-session modes (legacy / client_credentials),
	// which is exactly what stdio runs; it is opt-in via CREATIO_MCP_KEEPALIVE_SECONDS.
	const keepAlive = new SessionKeepAlive(keepAliveIntervalMs(), () =>
		engines.user.getCurrentUserInfo(),
	);
	keepAlive.start();
	const state: RuntimeState = { server, keepAlive };

	process.on('SIGINT', () => {
		void shutdown('SIGINT', state).finally(() => process.exit(0));
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM', state).finally(() => process.exit(0));
	});

	log.appStart({
		env: {
			node: process.version,
			transport: 'stdio',
		},
	});

	await startStdio(server);
}

// Only auto-run when invoked as the entry point (not when imported by tests).
if (require.main === module) {
	main().catch((err) => {
		log.error('startup.error', { error: String(err) });
		process.exit(1);
	});
}
