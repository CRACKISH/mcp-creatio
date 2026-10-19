import { describe, expect, it } from 'vitest';

import { OFFLINE_ACCESS_SCOPE, parseScopes, withOfflineAccess } from '../../src/creatio';

describe('parseScopes', () => {
	it.each([undefined, '', '   ', ' , ,'])('returns no scopes for %j', (raw) => {
		expect(parseScopes(raw)).toEqual([]);
	});

	it('splits on whitespace and commas, trimming and de-duplicating in order', () => {
		expect(
			parseScopes(' ApplicationAccess_abc,offline_access  ApplicationAccess_abc\tx '),
		).toEqual(['ApplicationAccess_abc', 'offline_access', 'x']);
	});

	it.each(['bad"quote', 'back\\slash', 'ünicode', 'ctrl\u0001'])(
		'rejects %j, which RFC 6749 §3.3 forbids in a scope-token (fail fast at startup)',
		(token) => {
			expect(() => parseScopes(`ok ${token}`)).toThrow(`invalid_oauth_scope:${token}`);
		},
	);
});

describe('withOfflineAccess', () => {
	it('defaults to offline_access alone', () => {
		expect(withOfflineAccess()).toEqual([OFFLINE_ACCESS_SCOPE]);
	});

	it('puts offline_access first and never duplicates it', () => {
		expect(withOfflineAccess(['ApplicationAccess_abc', OFFLINE_ACCESS_SCOPE])).toEqual([
			OFFLINE_ACCESS_SCOPE,
			'ApplicationAccess_abc',
		]);
	});
});
