#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getCreatioClientConfig } from './config-builder';
import { AuthProviderType, CreatioEngineManager, CreatioServiceContext } from './creatio';
import log from './log';
import { Server } from './server';
import { envBool } from './utils';

type CliOptions = Record<string, string>;

interface RuntimeState {
	server?: Server;
}

function printHelp(): void {
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
  -h, --help                   Show this help

Examples:
  mcp-creatio --base-url https://tenant.creatio.com --login your_login --password your_password
`.trim();
	process.stdout.write(text + '\n');
}

function parseArgs(argv: string[]): CliOptions {
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

function setEnvIfDefined(name: string, value?: string): void {
	if (typeof value === 'string' && value.length > 0) {
		process.env[name] = value;
	}
}

function applyCliEnv(opts: CliOptions): void {
	setEnvIfDefined('CREATIO_BASE_URL', opts['base-url'] || opts.url);
	setEnvIfDefined('CREATIO_LOGIN', opts.login);
	setEnvIfDefined('CREATIO_PASSWORD', opts.password);
	setEnvIfDefined('CREATIO_CLIENT_ID', opts['client-id']);
	setEnvIfDefined('CREATIO_CLIENT_SECRET', opts['client-secret']);
	setEnvIfDefined('CREATIO_ID_BASE_URL', opts['id-base-url']);
	setEnvIfDefined('READONLY_MODE', opts.readonly);
}

async function startStdio(server: Server): Promise<void> {
	const mcp = await server.startMcp();
	const transport = new StdioServerTransport();
	await mcp.connect(transport);
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
		await state.server?.stopMcp();
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

	applyCliEnv(opts);
	const cfg = getCreatioClientConfig();

	if (cfg.auth.kind === AuthProviderType.OAuth2Code) {
		throw new Error(
			'oauth2_code_requires_http_server: use "npm start" (HTTP /mcp mode) for OAuth2 authorization-code flow',
		);
	}

	const provider = new CreatioServiceContext(cfg);
	const engines = new CreatioEngineManager(provider);
	const server = new Server(engines, { readonlyMode: envBool('READONLY_MODE', false) });
	const state: RuntimeState = { server };

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

main().catch((err) => {
	log.error('startup.error', { error: String(err) });
	process.exit(1);
});
