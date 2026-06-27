import { describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { CreatioOAuthHandlers } from '../../src/server/http/creatio-oauth-handlers';

// A core-only auth provider (no revoke / interactive) — e.g. legacy or client-credentials.
const coreOnlyProvider = {
	type: AuthProviderType.Legacy,
	async getHeaders() {
		return {};
	},
	async refresh() {
		/* noop */
	},
	cancelAllRefresh() {
		/* noop */
	},
};

function makeHandlers() {
	const server = { authProvider: coreOnlyProvider } as never;
	const oauthServer = {} as never;
	return new CreatioOAuthHandlers(server, oauthServer);
}

function makeRes() {
	const res: any = {};
	res.status = vi.fn(() => res);
	res.send = vi.fn(() => res);
	res.redirect = vi.fn(() => res);
	return res;
}

describe('CreatioOAuthHandlers capability guards', () => {
	it('rejects /oauth/start with 400 when interactive auth is unsupported', async () => {
		const res = makeRes();
		await makeHandlers().handleOAuthStart({ query: { userKey: 'u1' } } as never, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.send).toHaveBeenCalledWith(expect.stringMatching(/not enabled/i));
		expect(res.redirect).not.toHaveBeenCalled();
	});

	it('rejects /oauth/revoke with 400 when revocation is unsupported', async () => {
		const res = makeRes();
		await makeHandlers().handleOAuthRevoke({ userKey: 'u1', query: {} } as never, res);
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.send).toHaveBeenCalledWith(expect.stringMatching(/not supported/i));
	});
});
