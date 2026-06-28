import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolvePublicOrigin } from '../../src/server/http/public-origin';

const req = (protocol: string, host: string) =>
	({ protocol, get: () => host }) as unknown as Parameters<typeof resolvePublicOrigin>[0];

describe('resolvePublicOrigin', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('uses the request origin when CREATIO_MCP_PUBLIC_URL is unset', () => {
		vi.stubEnv('CREATIO_MCP_PUBLIC_URL', '');
		expect(resolvePublicOrigin(req('http', 'localhost:3000'))).toBe('http://localhost:3000');
	});

	it('pins the configured public URL (proxy/ingress), trailing slash stripped', () => {
		vi.stubEnv('CREATIO_MCP_PUBLIC_URL', 'https://mcp.example.com/');
		expect(resolvePublicOrigin(req('http', 'mcp:3000'))).toBe('https://mcp.example.com');
	});
});
