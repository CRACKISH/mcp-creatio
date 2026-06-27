import { ReadQuery, ReadResult } from '../../../creatio/contracts';
import log from '../../../log';
import { ConfigurationCaller } from '../creatio-rest';

/**
 * Access layer for the Creatio "MCP Publishing" composable app (CrtMCPPublishingApp).
 *
 * That app is itself an MCP server hosted inside Creatio: admins publish `McpServer`
 * records (each a set of `McpTool`s backed by business processes) and it speaks
 * JSON-RPC 2.0 at `/0/rest/ToolServiceMcp/{code}/v1/mcp` (initialize / tools/list /
 * tools/call / ping).
 *
 * This client is a thin proxy front-end: it enumerates online servers, lists their
 * tools, and forwards tool calls — letting the app keep ownership of schema
 * derivation, RBAC, argument validation, output shaping and execution. It knows
 * nothing about MCP tool registration (that is the preparer's job).
 *
 * Both publication gates are honoured for free: `tools/list` only returns ENABLED
 * tools of ONLINE servers, and an offline server's endpoint fails closed.
 */

export interface PublishedServer {
	code: string;
	title: string;
}

export interface PublishedTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	annotations?: unknown;
}

/** Narrow capability needed to enumerate published servers (DIP over the CRUD engine). */
export interface EntityReader {
	read(query: Pick<ReadQuery, 'entity' | 'columns' | 'top'>): Promise<ReadResult>;
}

const SERVER_ENTITY = 'McpServer';

export class CrtMcpPublishingClient {
	private readonly _configuration: ConfigurationCaller;
	private readonly _crud: EntityReader;

	constructor(configuration: ConfigurationCaller, crud: EntityReader) {
		this._configuration = configuration;
		this._crud = crud;
	}

	/** Whether the publishing app is installed on this environment (its `McpServer` entity exists). */
	public async isInstalled(): Promise<boolean> {
		try {
			await this._crud.read({ entity: SERVER_ENTITY, columns: ['Id'], top: 1 });
			return true;
		} catch (err) {
			log.info('crtmcp.probe.not-installed', { error: String(err) });
			return false;
		}
	}

	/** Online published servers (the app filters offline ones out of routing anyway). */
	public async listOnlineServers(): Promise<PublishedServer[]> {
		const { items } = await this._crud.read({
			entity: SERVER_ENTITY,
			columns: ['Id', 'Name', 'Code', 'IsOnline'],
			top: 200,
		});
		const list = Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
		return list
			.filter((r) => r?.IsOnline === true && typeof r.Code === 'string' && r.Code.length > 0)
			.map((r) => ({ code: r.Code as string, title: (r.Name as string) ?? (r.Code as string) }));
	}

	/** Tool definitions advertised by a server's MCP `tools/list`. */
	public async listTools(serverCode: string): Promise<PublishedTool[]> {
		const result = await this._rpc(serverCode, 'tools/list', {});
		const tools = (result as { tools?: unknown } | null)?.tools;
		return Array.isArray(tools) ? (tools as PublishedTool[]) : [];
	}

	/**
	 * Execute a published tool, returning the MCP CallToolResult as-is
	 * (`{ content, structuredContent?, isError? }`) so the proxied output reaches the
	 * caller unchanged.
	 */
	public callTool(
		serverCode: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<unknown> {
		return this._rpc(serverCode, 'tools/call', { name, arguments: args ?? {} });
	}

	private async _rpc(serverCode: string, method: string, params: unknown): Promise<unknown> {
		const response = await this._configuration.call({
			rawPath: `/0/rest/ToolServiceMcp/${encodeURIComponent(serverCode)}/v1/mcp`,
			httpMethod: 'POST',
			body: { jsonrpc: '2.0', id: 1, method, params },
		});
		const body = response.body as {
			result?: unknown;
			error?: { code?: number; message?: string };
		} | null;
		if (body && body.error) {
			throw new Error(
				`crtmcp_rpc_error:${method}:${body.error.code ?? ''} ${body.error.message ?? ''}`.trim(),
			);
		}
		return body?.result;
	}
}
