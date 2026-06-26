import crypto from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { SessionContext } from '../../src/services/session-context';
import {
	challengeS256,
	env,
	envBool,
	generateCodeVerifier,
	generatePkcePair,
	getClientIp,
	getEffectiveUserKey,
	getSessionIdFromRequest,
	getUserKeyFromRequest,
	parseSetCookie,
	runWithContext,
	withValidation,
} from '../../src/utils';
import { resetSessionContext } from '../support/test-server';

describe('getUserKeyFromRequest precedence (C4 surface)', () => {
	it('prefers the x-user-key header', () => {
		expect(
			getUserKeyFromRequest({ headers: { 'x-user-key': 'h' }, query: { userKey: 'q' } } as never),
		).toBe('h');
	});

	it('falls back to the userKey query param', () => {
		expect(getUserKeyFromRequest({ headers: {}, query: { userKey: 'q' } } as never)).toBe('q');
	});

	it('derives user_<sessionId> from the session id', () => {
		expect(
			getUserKeyFromRequest({ headers: { 'mcp-session-id': 's1' }, query: {} } as never),
		).toBe('user_s1');
	});

	it('returns undefined when nothing identifies the caller', () => {
		expect(getUserKeyFromRequest({ headers: {}, query: {} } as never)).toBeUndefined();
	});
});

describe('getSessionIdFromRequest', () => {
	it('reads the mcp-session-id header first', () => {
		expect(
			getSessionIdFromRequest({ headers: { 'mcp-session-id': 'a' }, query: { session_id: 'b' } } as never),
		).toBe('a');
	});

	it('falls back to the session_id query param', () => {
		expect(getSessionIdFromRequest({ headers: {}, query: { session_id: 'b' } } as never)).toBe('b');
	});
});

describe('getClientIp', () => {
	it('prefers x-forwarded-for, then req.ip, then the socket address', () => {
		expect(getClientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } } as never)).toBe(
			'1.1.1.1',
		);
		expect(getClientIp({ headers: {}, ip: '3.3.3.3' } as never)).toBe('3.3.3.3');
		expect(
			getClientIp({ headers: {}, socket: { remoteAddress: '4.4.4.4' } } as never),
		).toBe('4.4.4.4');
	});
});

describe('parseSetCookie', () => {
	it('extracts name/value pairs and ignores attributes', () => {
		expect(parseSetCookie(['BPMCSRF=abc; Path=/; HttpOnly', 'BPMSESSIONID=zzz; Secure'])).toEqual([
			{ name: 'BPMCSRF', value: 'abc' },
			{ name: 'BPMSESSIONID', value: 'zzz' },
		]);
	});
});

describe('runWithContext / getEffectiveUserKey', () => {
	beforeEach(() => resetSessionContext());

	it('returns the explicit userKey when present', async () => {
		await runWithContext({ userKey: 'u' }, async () => {
			expect(getEffectiveUserKey()).toBe('u');
		});
	});

	it('falls back to the session mapping, then to the raw session id', async () => {
		SessionContext.instance.createSession('s1', 'mapped-user');
		await runWithContext({ sessionId: 's1' }, async () => {
			expect(getEffectiveUserKey()).toBe('mapped-user');
		});
		await runWithContext({ sessionId: 's-unmapped' }, async () => {
			expect(getEffectiveUserKey()).toBe('s-unmapped');
		});
	});

	it('returns undefined outside any context', () => {
		expect(getEffectiveUserKey()).toBeUndefined();
	});
});

describe('PKCE helpers', () => {
	it('generates a base64url verifier of the requested length', () => {
		const v = generateCodeVerifier(32);
		expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(v.length).toBeGreaterThanOrEqual(43);
	});

	it('produces an S256 challenge that matches Node crypto', async () => {
		const verifier = 'fixed-verifier-value';
		const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
		expect(await challengeS256(verifier)).toBe(expected);
	});

	it('generatePkcePair returns a matching verifier/challenge', async () => {
		const { verifier, challenge } = await generatePkcePair();
		expect(challenge).toBe(await challengeS256(verifier));
	});
});

describe('env / envBool', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('trims and returns undefined for blank values', () => {
		vi.stubEnv('SOME_VAR', '  hello  ');
		expect(env('SOME_VAR')).toBe('hello');
		vi.stubEnv('BLANK_VAR', '   ');
		expect(env('BLANK_VAR')).toBeUndefined();
	});

	it('parses booleans with a default fallback', () => {
		vi.stubEnv('B1', 'true');
		vi.stubEnv('B2', '1');
		vi.stubEnv('B3', 'false');
		expect(envBool('B1', false)).toBe(true);
		expect(envBool('B2', false)).toBe(true);
		expect(envBool('B3', true)).toBe(false);
		expect(envBool('B_MISSING', true)).toBe(true);
	});
});

describe('withValidation', () => {
	it('parses the payload and forwards the typed value', async () => {
		const handler = withValidation(z.object({ n: z.number() }), async ({ n }) => n * 2);
		expect(await handler({ n: 21 })).toBe(42);
	});

	it('throws when the payload fails schema validation', async () => {
		const handler = withValidation(z.object({ n: z.number() }), async () => 'ok');
		await expect(handler({ n: 'not-a-number' })).rejects.toThrow();
	});
});
