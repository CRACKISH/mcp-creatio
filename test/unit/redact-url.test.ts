import { describe, expect, it } from 'vitest';

import { redactUrl } from '../../src/server/http/middleware';

describe('redactUrl', () => {
	it('returns the URL unchanged when there is no query string', () => {
		expect(redactUrl('/mcp')).toBe('/mcp');
	});

	it('redacts single-use OAuth credentials from the query (CWE-532)', () => {
		const out = redactUrl('/oauth/callback?code=SECRET&state=ABC123');
		expect(out).not.toContain('SECRET');
		expect(out).not.toContain('ABC123');
		expect(out).toContain('code=***');
		expect(out.startsWith('/oauth/callback?')).toBe(true);
	});

	it('preserves non-sensitive params for debugging', () => {
		const out = redactUrl('/authorize?client_id=abc&code_verifier=zzz&scope=offline_access');
		expect(out).toContain('client_id=abc');
		expect(out).toContain('scope=offline_access');
		expect(out).not.toContain('zzz');
	});
});
