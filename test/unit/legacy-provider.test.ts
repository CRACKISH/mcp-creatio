import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProviderType } from '../../src/creatio';
import { LegacyProvider } from '../../src/creatio/auth/providers/legacy-provider';
import { JSON_ACCEPT } from '../../src/types';

function makeProvider() {
	return new LegacyProvider({
		baseUrl: 'https://tenant.creatio.local',
		auth: { kind: AuthProviderType.Legacy, login: 'admin', password: 'secret' },
	} as never);
}

function loginResponse(setCookie: string[]): Response {
	const headers = new Headers();
	for (const c of setCookie) {
		headers.append('set-cookie', c);
	}
	return new Response('', { status: 200, headers });
}

afterEach(() => vi.unstubAllGlobals());

describe('LegacyProvider', () => {
	it('logs in, then sends Cookie + BPMCSRF + ForceUseSession headers', async () => {
		const fetchMock = vi.fn(async () =>
			loginResponse(['BPMCSRF=tok123; Path=/', 'BPMSESSIONID=sess; Path=/']),
		);
		vi.stubGlobal('fetch', fetchMock);
		const provider = makeProvider();

		const headers = await provider.getHeaders(JSON_ACCEPT, true);

		expect(fetchMock.mock.calls[0][0]).toContain('/ServiceModel/AuthService.svc/Login');
		expect(headers.Cookie).toContain('BPMCSRF=tok123');
		expect(headers.Cookie).toContain('BPMSESSIONID=sess');
		expect(headers.BPMCSRF).toBe('tok123');
		expect(headers.ForceUseSession).toBe('true');
	});

	it('reuses the session on the second call (logs in only once)', async () => {
		const fetchMock = vi.fn(async () => loginResponse(['BPMCSRF=tok; Path=/']));
		vi.stubGlobal('fetch', fetchMock);
		const provider = makeProvider();
		await provider.getHeaders(JSON_ACCEPT, true);
		await provider.getHeaders(JSON_ACCEPT, true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('throws when the login request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 401 })),
		);
		await expect(makeProvider().getHeaders(JSON_ACCEPT, true)).rejects.toThrow(/auth_failed/);
	});

	it('refresh() drops the cached session and logs in again', async () => {
		const fetchMock = vi.fn(async () => loginResponse(['BPMCSRF=tok; Path=/']));
		vi.stubGlobal('fetch', fetchMock);
		const provider = makeProvider();
		await provider.getHeaders(JSON_ACCEPT, true);
		await provider.refresh();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('throws when no Set-Cookie is returned', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 200 })),
		);
		await expect(makeProvider().getHeaders(JSON_ACCEPT, true)).rejects.toThrow(/no_set_cookie/);
	});
});
