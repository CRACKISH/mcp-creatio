import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { inspectBearer, isExpired } from '../../src/server/bearer/bearer-token';

describe('inspectBearer', () => {
	it('extracts sub + exp from a JWT', () => {
		const token = jwt.sign({ sub: 'user-42' }, 'secret', { expiresIn: 3600 });
		const d = inspectBearer(token);
		expect(d.isJwt).toBe(true);
		expect(d.userKey).toBe('user-42');
		expect(typeof d.expSeconds).toBe('number');
	});

	it('falls back to a stable fingerprint for a JWT without sub', () => {
		const token = jwt.sign({ foo: 'bar' }, 'secret');
		const d = inspectBearer(token);
		expect(d.isJwt).toBe(true);
		expect(d.userKey).toMatch(/^tok_/);
	});

	it('fingerprints an opaque (non-JWT) token deterministically', () => {
		const a = inspectBearer('opaque-reference-token');
		const b = inspectBearer('opaque-reference-token');
		expect(a.isJwt).toBe(false);
		expect(a.userKey).toMatch(/^tok_/);
		expect(a.userKey).toBe(b.userKey);
	});
});

describe('isExpired', () => {
	it('reports an expired JWT', () => {
		const token = jwt.sign({ sub: 'u' }, 'secret', { expiresIn: -3600 });
		expect(isExpired(inspectBearer(token))).toBe(true);
	});

	it('reports a still-valid JWT as not expired', () => {
		const token = jwt.sign({ sub: 'u' }, 'secret', { expiresIn: 3600 });
		expect(isExpired(inspectBearer(token))).toBe(false);
	});

	it('never treats an opaque token (no exp) as expired', () => {
		expect(isExpired(inspectBearer('opaque'))).toBe(false);
	});
});
