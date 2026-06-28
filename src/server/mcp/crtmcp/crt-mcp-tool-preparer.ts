import log from '../../../log';
import { jsonSchemaToZodShape } from '../json-schema-to-zod';
import { ToolPreparer, ToolRegistrar } from '../tool-preparer';

import { CrtMcpPublishingClient, PublishedTool } from './crt-mcp-client';

/** Stable capability key. */
export const PUBLISHED_TOOLS_CAPABILITY = 'published-tools';

const NAME_PREFIX = 'pub';

/**
 * Registers tools published in the Creatio "MCP Publishing" composable app, but only
 * when explicitly enabled (a hidden, opt-in feature) AND the app is installed. Each
 * published tool is re-exposed under a namespaced name and proxied back to the app's
 * JSON-RPC endpoint, so the app keeps ownership of validation/RBAC/execution.
 */
export class CrtMcpPublishingToolPreparer implements ToolPreparer {
	private readonly _client: CrtMcpPublishingClient;
	private readonly _enabled: boolean;

	public readonly name = PUBLISHED_TOOLS_CAPABILITY;

	constructor(client: CrtMcpPublishingClient, enabled: boolean) {
		this._client = client;
		this._enabled = enabled;
	}

	private _registerTool(registrar: ToolRegistrar, serverCode: string, tool: PublishedTool): void {
		const descriptor = {
			title: tool.name,
			description:
				tool.description ??
				`Published tool "${tool.name}" from Creatio MCP server "${serverCode}".`,
			inputSchema: jsonSchemaToZodShape(tool.inputSchema),
		};
		// Proxy the call straight through; the app validates args and shapes the result.
		const handler = (args: Record<string, unknown>) =>
			this._client.callTool(serverCode, tool.name, args ?? {});
		registrar.register(this._toolName(serverCode, tool.name), descriptor, handler);
	}

	// Namespace by server + tool so names never collide across servers or with built-in tools.
	private _toolName(serverCode: string, toolName: string): string {
		const sanitize = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
		return `${NAME_PREFIX}-${sanitize(serverCode)}-${sanitize(toolName)}`;
	}

	public async prepare(registrar: ToolRegistrar): Promise<boolean> {
		if (!this._enabled) {
			return false;
		}
		if (!(await this._client.isInstalled())) {
			log.info('crtmcp.skipped', { reason: 'app-not-installed' });
			return false;
		}
		const servers = await this._client.listOnlineServers();
		let registered = 0;
		for (const server of servers) {
			let tools: PublishedTool[];
			try {
				tools = await this._client.listTools(server.code);
			} catch (err) {
				log.warn('crtmcp.list-failed', { server: server.code, error: String(err) });
				continue;
			}
			for (const tool of tools) {
				if (!tool?.name) {
					continue;
				}
				this._registerTool(registrar, server.code, tool);
				registered++;
			}
		}
		log.info('crtmcp.prepared', { servers: servers.length, tools: registered });
		return registered > 0;
	}
}
