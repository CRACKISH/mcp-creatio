import { describe, expect, it, vi } from 'vitest';

import { CrtMcpPublishingClient } from '../../src/server/mcp/crtmcp/crt-mcp-client';
import { CrtMcpPublishingToolPreparer } from '../../src/server/mcp/crtmcp/crt-mcp-tool-preparer';
import { ToolHandler } from '../../src/server/mcp/tool-preparer';

function makeRegistrar() {
	const registered = new Map<string, { descriptor: any; handler: ToolHandler }>();
	return {
		registrar: { register: (name: string, descriptor: any, handler: ToolHandler) => registered.set(name, { descriptor, handler }) },
		registered,
	};
}

function makeClient(over?: Partial<CrtMcpPublishingClient>): CrtMcpPublishingClient {
	return {
		isInstalled: vi.fn(async () => true),
		listOnlineServers: vi.fn(async () => [{ code: 'Srv', title: 'Srv' }]),
		listTools: vi.fn(async () => [
			{ name: 'get-thing', description: 'Get a thing', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
		]),
		callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
		...over,
	} as unknown as CrtMcpPublishingClient;
}

describe('CrtMcpPublishingToolPreparer', () => {
	it('registers nothing when disabled (flag off)', async () => {
		const client = makeClient();
		const { registrar, registered } = makeRegistrar();
		const enabled = await new CrtMcpPublishingToolPreparer(client, false).prepare(registrar);
		expect(enabled).toBe(false);
		expect(registered.size).toBe(0);
		expect(client.isInstalled).not.toHaveBeenCalled();
	});

	it('registers nothing when enabled but the app is not installed', async () => {
		const client = makeClient({ isInstalled: vi.fn(async () => false) } as never);
		const { registrar, registered } = makeRegistrar();
		const enabled = await new CrtMcpPublishingToolPreparer(client, true).prepare(registrar);
		expect(enabled).toBe(false);
		expect(registered.size).toBe(0);
	});

	it('registers published tools under a namespaced name and proxies calls', async () => {
		const client = makeClient();
		const { registrar, registered } = makeRegistrar();
		const enabled = await new CrtMcpPublishingToolPreparer(client, true).prepare(registrar);

		expect(enabled).toBe(true);
		const entry = registered.get('pub-Srv-get-thing');
		expect(entry).toBeDefined();
		expect(entry!.descriptor.title).toBe('get-thing');
		expect(entry!.descriptor.description).toBe('Get a thing');
		// input schema was converted into a zod raw shape (has the `id` property)
		expect(Object.keys(entry!.descriptor.inputSchema)).toEqual(['id']);

		// the handler proxies straight to callTool(server, originalName, args)
		await entry!.handler({ id: '42' });
		expect(client.callTool).toHaveBeenCalledWith('Srv', 'get-thing', { id: '42' });
	});

	it('sanitizes names and skips a server whose tools/list fails', async () => {
		const client = makeClient({
			listOnlineServers: vi.fn(async () => [
				{ code: 'A B', title: 'A B' },
				{ code: 'Bad', title: 'Bad' },
			]),
			listTools: vi.fn(async (code: string) => {
				if (code === 'Bad') {
					throw new Error('offline');
				}
				return [{ name: 'do.it', inputSchema: {} }];
			}),
		} as never);
		const { registrar, registered } = makeRegistrar();
		await new CrtMcpPublishingToolPreparer(client, true).prepare(registrar);
		expect([...registered.keys()]).toEqual(['pub-A_B-do_it']);
	});
});
