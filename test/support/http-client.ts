import { vi } from 'vitest';

import { CreatioHttpClient } from '../../src/creatio/services/http-client';

export interface FetchCall {
	url: string;
	init: RequestInit;
}

export type FetchResponder = (url: string, init: RequestInit) => Response | Promise<Response>;

/**
 * Builds a real CreatioHttpClient backed by a stub auth manager (so the real
 * executeWithTiming / header plumbing is exercised) and a controllable global
 * fetch. Returns the recorded calls for assertions.
 */
export function makeHttpClientHarness(
	responder: FetchResponder,
	baseUrl = 'https://tenant.creatio.local',
) {
	const authManager = {
		getProvider: () => ({
			async getHeaders() {
				return { Authorization: 'Bearer test-token' };
			},
			async refresh() {
				/* noop */
			},
		}),
	};
	const client = new CreatioHttpClient(
		{ baseUrl, auth: { kind: 'oauth2' } } as never,
		authManager as never,
	);
	const calls: FetchCall[] = [];
	const fetchMock = vi.fn(async (url: unknown, init: unknown) => {
		calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
		return responder(String(url), (init ?? {}) as RequestInit);
	});
	vi.stubGlobal('fetch', fetchMock);
	return { client, calls, fetchMock };
}

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export function textResponse(text: string, status = 200): Response {
	return new Response(text, { status, headers: { 'content-type': 'text/plain' } });
}

export function bodyOf(call: FetchCall): unknown {
	const raw = call.init.body;
	return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
