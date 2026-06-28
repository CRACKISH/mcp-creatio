import { describe, expect, it } from 'vitest';

import { isAllowedBaseUrl, parseAllowedBaseUrls } from '../../src/server/bearer/base-url-guard';

describe('parseAllowedBaseUrls', () => {
	it('splits on commas/whitespace and normalizes (lowercase, no trailing slash)', () => {
		expect(parseAllowedBaseUrls('https://A.creatio.com/, https://B.creatio.com')).toEqual([
			'https://a.creatio.com',
			'https://b.creatio.com',
		]);
	});

	it('returns [] for undefined/empty', () => {
		expect(parseAllowedBaseUrls(undefined)).toEqual([]);
		expect(parseAllowedBaseUrls('')).toEqual([]);
	});
});

describe('isAllowedBaseUrl — no allowlist (trusted gateway)', () => {
	it('allows any http/https host', () => {
		expect(isAllowedBaseUrl('https://tenant1.creatio.com', [])).toBe(true);
		expect(isAllowedBaseUrl('http://on-prem.local:8080', [])).toBe(true);
	});

	it('rejects non-http(s) schemes', () => {
		expect(isAllowedBaseUrl('file:///etc/passwd', [])).toBe(false);
		expect(isAllowedBaseUrl('gopher://x', [])).toBe(false);
		expect(isAllowedBaseUrl('not a url', [])).toBe(false);
	});

	it('always blocks the cloud metadata link-local address (SSRF)', () => {
		expect(isAllowedBaseUrl('http://169.254.169.254/latest/meta-data', [])).toBe(false);
		expect(isAllowedBaseUrl('http://169.254.1.1', [])).toBe(false);
	});
});

describe('isAllowedBaseUrl — with allowlist', () => {
	const allow = ['https://a.creatio.com', 'https://b.creatio.com'];

	it('allows an exact or sub-path match', () => {
		expect(isAllowedBaseUrl('https://a.creatio.com', allow)).toBe(true);
		expect(isAllowedBaseUrl('https://a.creatio.com/instance1', allow)).toBe(true);
		expect(isAllowedBaseUrl('https://B.creatio.com/', allow)).toBe(true);
	});

	it('rejects a host not on the list (token-redirection)', () => {
		expect(isAllowedBaseUrl('https://attacker.com', allow)).toBe(false);
		// Prefix-only tricks must not pass (no false `startsWith` on the bare host).
		expect(isAllowedBaseUrl('https://a.creatio.com.evil.com', allow)).toBe(false);
	});
});
