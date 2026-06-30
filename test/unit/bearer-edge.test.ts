import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { AuthProviderType, BearerAuthMode } from '../../src/creatio';
import { BearerEdge, buildProtectedResourceMetadata } from '../../src/server/bearer/bearer-edge';

function delegated() {
	return { kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Delegated } as never;
}
function gateway() {
	return { kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Gateway } as never;
}

function mockReq(headers: Record<string, string> = {}) {
	return { headers, protocol: 'http', get: () => 'localhost:3000' } as Record<string, unknown>;
}
function mockRes() {
	const res: Record<string, unknown> = { statusCode: 200, headers: {} };
	res.setHeader = vi.fn((k: string, v: string) => {
		(res.headers as Record<string, string>)[k] = v;
	});
	res.status = vi.fn((c: number) => {
		res.statusCode = c;
		return res;
	});
	res.json = vi.fn(() => res);
	return res;
}

const BASE = 'https://t.creatio.local';

describe('buildProtectedResourceMetadata (RFC 9728)', () => {
	it('advertises Creatio Identity as the authorization server', () => {
		expect(
			buildProtectedResourceMetadata('https://mcp.local/mcp', 'https://t.local/0'),
		).toEqual({
			resource: 'https://mcp.local/mcp',
			authorization_servers: ['https://t.local/0'],
			scopes_supported: ['offline_access'],
			bearer_methods_supported: ['header'],
		});
	});
});

describe('BearerEdge.mcpAuth — challenges', () => {
	it('delegated: missing token → 401 with WWW-Authenticate resource_metadata', () => {
		const req = mockReq();
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(delegated(), BASE).mcpAuth()(req as never, res as never, next);
		expect(res.statusCode).toBe(401);
		expect((res.headers as Record<string, string>)['WWW-Authenticate']).toContain(
			'resource_metadata=',
		);
		expect(next).not.toHaveBeenCalled();
	});

	it('gateway: missing token → 401 without a challenge header', () => {
		const req = mockReq();
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(gateway(), BASE).mcpAuth()(req as never, res as never, next);
		expect(res.statusCode).toBe(401);
		expect((res.headers as Record<string, string>)['WWW-Authenticate']).toBeUndefined();
		expect(next).not.toHaveBeenCalled();
	});
});

describe('BearerEdge.mcpAuth — gateway mode', () => {
	it('trusts the injected token and honors X-Creatio-Base-Url', () => {
		const req = mockReq({
			authorization: 'Bearer GW-TOKEN',
			'x-creatio-base-url': 'https://other.local',
		});
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(gateway(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).toHaveBeenCalled();
		expect(req.credential).toEqual({ kind: 'bearer', token: 'GW-TOKEN' });
		expect(req.userKey).toBeTruthy();
		expect(req.baseUrlOverride).toBe('https://other.local');
	});

	it('rejects an SSRF-y X-Creatio-Base-Url override (cloud metadata IP) with 400', () => {
		const req = mockReq({
			authorization: 'Bearer GW-TOKEN',
			'x-creatio-base-url': 'http://169.254.169.254/latest/meta-data',
		});
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(gateway(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.statusCode).toBe(400);
	});
});

describe('BearerEdge.mcpAuth — cookie passthrough', () => {
	it('gateway: accepts a forwarded cookie session (X-Creatio-Cookie), extracting BPMCSRF', () => {
		const req = mockReq({ 'x-creatio-cookie': 'BPMCSRF=csrf-1; .ASPXAUTH=sess' });
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(gateway(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).toHaveBeenCalled();
		expect(req.credential).toEqual({
			kind: 'cookie',
			cookie: 'BPMCSRF=csrf-1; .ASPXAUTH=sess',
			bpmcsrf: 'csrf-1',
		});
	});

	it('delegated: accepts a cookie and prefers an explicit X-Creatio-BPMCSRF header', () => {
		const req = mockReq({
			'x-creatio-cookie': 'BPMCSRF=from-cookie; .ASPXAUTH=sess',
			'x-creatio-bpmcsrf': 'explicit',
		});
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(delegated(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).toHaveBeenCalled();
		expect((req.credential as { bpmcsrf?: string }).bpmcsrf).toBe('explicit');
	});
});

describe('BearerEdge.mcpAuth — delegated mode', () => {
	it('passes a non-expired JWT through, deriving userKey from sub', () => {
		const token = jwt.sign({ sub: 'user-9' }, 'secret', { expiresIn: 3600 });
		const req = mockReq({ authorization: `Bearer ${token}` });
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(delegated(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).toHaveBeenCalled();
		expect(req.userKey).toBe('user-9');
		expect(req.credential).toEqual({ kind: 'bearer', token });
	});

	it('fails fast on an expired JWT → 401', () => {
		const token = jwt.sign({ sub: 'user-9' }, 'secret', { expiresIn: -3600 });
		const req = mockReq({ authorization: `Bearer ${token}` });
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(delegated(), BASE).mcpAuth()(req as never, res as never, next);
		expect(res.statusCode).toBe(401);
		expect(next).not.toHaveBeenCalled();
	});

	it('does NOT honor X-Creatio-Base-Url in delegated mode (only gateway may override)', () => {
		const token = jwt.sign({ sub: 'u' }, 'secret', { expiresIn: 3600 });
		const req = mockReq({
			authorization: `Bearer ${token}`,
			'x-creatio-base-url': 'https://attacker.local',
		});
		const res = mockRes();
		const next = vi.fn();
		new BearerEdge(delegated(), BASE).mcpAuth()(req as never, res as never, next);
		expect(next).toHaveBeenCalled();
		expect(req.baseUrlOverride).toBeUndefined();
	});
});
