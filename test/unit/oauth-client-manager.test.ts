import { describe, expect, it } from 'vitest';

import { OAuthClientManager } from '../../src/server/oauth/client-manager';

describe('OAuthClientManager.autoRegisterClient', () => {
	const redirect = 'http://localhost:1/cb';

	it('recognizes claude clients', () => {
		const c = OAuthClientManager.autoRegisterClient('claude-desktop-123', redirect);
		expect(c.client_id).toBe('claude-desktop-123');
		expect(c.redirect_uris).toEqual([redirect]);
		expect(c.grant_types).toEqual(['authorization_code', 'refresh_token']);
		expect(c.token_endpoint_auth_method).toBe('none');
	});

	it('recognizes vscode clients', () => {
		expect(OAuthClientManager.autoRegisterClient('vscode-mcp', redirect).client_id).toBe(
			'vscode-mcp',
		);
	});

	it('recognizes cursor clients', () => {
		expect(OAuthClientManager.autoRegisterClient('cursor-x', redirect).client_id).toBe(
			'cursor-x',
		);
	});

	it('handles unknown client names', () => {
		const c = OAuthClientManager.autoRegisterClient('something-else', redirect);
		expect(c.client_id).toBe('something-else');
		expect(c.response_types).toEqual(['code']);
	});
});

describe('OAuthClientManager.createClient', () => {
	it('mints a random UUID client_id with the standard grants', () => {
		const c = OAuthClientManager.createClient([
			'http://localhost:1/cb',
			'http://127.0.0.1/cb2',
		]);
		expect(c.client_id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(c.redirect_uris).toEqual(['http://localhost:1/cb', 'http://127.0.0.1/cb2']);
		expect(c.grant_types).toContain('authorization_code');
		expect(c.grant_types).toContain('refresh_token');
		// IDs are random per call.
		expect(c.client_id).not.toBe(
			OAuthClientManager.createClient(['http://localhost:1/cb']).client_id,
		);
	});
});
