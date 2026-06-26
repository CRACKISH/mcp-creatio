import { describe, expect, it } from 'vitest';

import { OAuthValidators } from '../../src/server/oauth/validators';

describe('OAuthValidators.isAllowedRedirectUri (H2 / open redirect)', () => {
	it('allows loopback http/https', () => {
		expect(OAuthValidators.isAllowedRedirectUri('http://localhost:1234/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('http://127.0.0.1/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('https://localhost:9/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('http://[::1]:7/cb')).toBe(true);
	});

	it('allows custom app-scheme deep links', () => {
		expect(OAuthValidators.isAllowedRedirectUri('vscode://anysoft/cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('cursor://cb')).toBe(true);
		expect(OAuthValidators.isAllowedRedirectUri('com.example.app:/cb')).toBe(true);
	});

	it('blocks remote http(s) origins', () => {
		expect(OAuthValidators.isAllowedRedirectUri('https://evil.example.com/cb')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('http://attacker.test/cb')).toBe(false);
	});

	it('blocks script/data/file schemes', () => {
		expect(OAuthValidators.isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('data:text/html,x')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('file:///etc/passwd')).toBe(false);
	});

	it('rejects malformed URIs', () => {
		expect(OAuthValidators.isAllowedRedirectUri('not a url')).toBe(false);
		expect(OAuthValidators.isAllowedRedirectUri('')).toBe(false);
	});
});

describe('OAuthValidators.validateClientRegistration', () => {
	it('rejects a disallowed redirect_uri', () => {
		const err = OAuthValidators.validateClientRegistration(['https://evil.com/cb']);
		expect(err).toMatch(/Disallowed/);
	});

	it('accepts a loopback redirect_uri', () => {
		expect(OAuthValidators.validateClientRegistration(['http://localhost:1/cb'])).toBeNull();
	});

	it('requires an array of URIs', () => {
		expect(OAuthValidators.validateClientRegistration(undefined)).toMatch(/required/);
		expect(OAuthValidators.validateClientRegistration([])).toMatch(/at least one/);
	});
});
