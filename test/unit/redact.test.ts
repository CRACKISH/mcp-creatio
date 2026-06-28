import { describe, expect, it } from 'vitest';

import { redactError, redactSecrets } from '../../src/utils/redact';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.s3cr3t-signature_value';

describe('redactSecrets', () => {
	it('masks a Bearer token but keeps the scheme', () => {
		const out = redactSecrets(`Authorization header was Bearer ${JWT}`);
		expect(out).not.toContain(JWT);
		expect(out).toContain('Bearer [REDACTED]');
	});

	it('masks Basic / ApiKey / Token scheme values', () => {
		expect(redactSecrets('Basic dXNlcjpwYXNz')).toBe('Basic [REDACTED]');
		expect(redactSecrets('ApiKey abc123.def')).toBe('ApiKey [REDACTED]');
		expect(redactSecrets('Token zzz-999')).toBe('Token [REDACTED]');
	});

	it('masks an Authorization header in colon and equals forms', () => {
		expect(redactSecrets('Authorization: secretvalue')).toBe('Authorization: [REDACTED]');
		expect(redactSecrets('authorization=secretvalue')).toBe('authorization=[REDACTED]');
	});

	it('masks secret values in query-string form, preserving the key and trailing params', () => {
		const out = redactSecrets('grant?client_secret=s3cr3t&grant_type=client_credentials');
		expect(out).not.toContain('s3cr3t');
		expect(out).toContain('client_secret=[REDACTED]');
		expect(out).toContain('grant_type=client_credentials');
	});

	it('masks secret values in JSON form and keeps the JSON well-formed', () => {
		const out = redactSecrets('{"password":"hunter2","name":"Acme"}');
		expect(out).not.toContain('hunter2');
		expect(out).toContain('"password":"[REDACTED]"');
		// closing quote preserved → still parseable
		expect(() => JSON.parse(out)).not.toThrow();
		expect(JSON.parse(out)).toMatchObject({ password: '[REDACTED]', name: 'Acme' });
	});

	it('masks access_token, refresh_token and BPMCSRF', () => {
		expect(redactSecrets('access_token=AAA.BBB.CCC')).toBe('access_token=[REDACTED]');
		expect(redactSecrets('"refresh_token": "rt-123"')).toContain('"refresh_token": "[REDACTED]"');
		expect(redactSecrets('Cookie: BPMCSRF=xyz123')).toContain('BPMCSRF=[REDACTED]');
	});

	it('leaves non-secret text untouched', () => {
		const safe = 'Order Number 1024 for Account "Acme Corp" created on 2026-06-28';
		expect(redactSecrets(safe)).toBe(safe);
	});

	it('is idempotent', () => {
		const once = redactSecrets(`Bearer ${JWT} client_secret=abc`);
		expect(redactSecrets(once)).toBe(once);
	});

	it('returns non-string input coerced to a string without throwing', () => {
		expect(redactSecrets(undefined)).toBe('');
		expect(redactSecrets(null)).toBe('');
		expect(redactSecrets(42)).toBe('42');
	});
});

describe('redactError', () => {
	it('redacts the message in place and preserves the Error instance', () => {
		const original = new Error(`login failed: Bearer ${JWT}`);
		const out = redactError(original);
		expect(out).toBe(original); // same instance → stack/type preserved
		expect(out.message).toContain('Bearer [REDACTED]');
		expect(out.message).not.toContain(JWT);
	});

	it('wraps a non-Error throwable into a redacted Error', () => {
		const out = redactError('raw failure with access_token=leak123');
		expect(out).toBeInstanceOf(Error);
		expect(out.message).toContain('access_token=[REDACTED]');
		expect(out.message).not.toContain('leak123');
	});
});
