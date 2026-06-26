import { describe, expect, it, vi } from 'vitest';

import { ConfigurationCaller, ConfigurationCallResult } from '../../src/server/mcp/creatio-rest';
import { CrtMcpPublishingClient, EntityReader } from '../../src/server/mcp/crtmcp/crt-mcp-client';

function makeClient(overrides?: {
	call?: ConfigurationCaller['call'];
	read?: EntityReader['read'];
}) {
	const call = vi.fn(
		overrides?.call ??
			(async () => ({ status: 200, body: { result: {} } }) as ConfigurationCallResult),
	);
	const read = vi.fn(overrides?.read ?? (async () => []));
	const client = new CrtMcpPublishingClient({ call }, { read });
	return { client, call, read };
}

describe('CrtMcpPublishingClient.isInstalled', () => {
	it('is true when McpServer can be read', async () => {
		const { client, read } = makeClient({ read: async () => [{ Id: '1' }] });
		expect(await client.isInstalled()).toBe(true);
		expect(read).toHaveBeenCalledWith({ entity: 'McpServer', select: ['Id'], top: 1 });
	});

	it('is false (degrades) when the entity read throws', async () => {
		const { client } = makeClient({
			read: async () => {
				throw new Error('entity_not_found');
			},
		});
		expect(await client.isInstalled()).toBe(false);
	});
});

describe('CrtMcpPublishingClient.listOnlineServers', () => {
	it('keeps only online servers with a code', async () => {
		const { client } = makeClient({
			read: async () => [
				{ Code: 'A', Name: 'Alpha', IsOnline: true },
				{ Code: 'B', Name: 'Beta', IsOnline: false },
				{ Code: '', Name: 'NoCode', IsOnline: true },
				{ Name: 'Missing', IsOnline: true },
			],
		});
		expect(await client.listOnlineServers()).toEqual([{ code: 'A', title: 'Alpha' }]);
	});
});

describe('CrtMcpPublishingClient JSON-RPC', () => {
	it('posts tools/list to the per-server rawPath and returns the tools array', async () => {
		const { client, call } = makeClient({
			call: async () => ({
				status: 200,
				body: { result: { tools: [{ name: 't1' }, { name: 't2' }] } },
			}),
		});
		const tools = await client.listTools('My Server');
		expect(call).toHaveBeenCalledWith({
			rawPath: '/0/rest/ToolServiceMcp/My%20Server/v1/mcp',
			httpMethod: 'POST',
			body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
		});
		expect(tools).toEqual([{ name: 't1' }, { name: 't2' }]);
	});

	it('forwards tools/call with name + arguments and returns the result', async () => {
		const result = { content: [{ type: 'text', text: 'ok' }] };
		const { client, call } = makeClient({
			call: async () => ({ status: 200, body: { result } }),
		});
		const res = await client.callTool('Srv', 'doThing', { a: 1 });
		expect(call.mock.calls[0]![0].body).toEqual({
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'doThing', arguments: { a: 1 } },
		});
		expect(res).toEqual(result);
	});

	it('throws on a JSON-RPC error envelope', async () => {
		const { client } = makeClient({
			call: async () => ({
				status: 200,
				body: { error: { code: -32601, message: 'Method not found' } },
			}),
		});
		await expect(client.listTools('Srv')).rejects.toThrow(/crtmcp_rpc_error/);
	});
});
