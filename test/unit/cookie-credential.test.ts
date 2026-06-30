import { describe, expect, it } from 'vitest';

import { buildCookieHeaders } from '../../src/creatio/auth/headers';
import { extractBpmcsrf } from '../../src/utils';

describe('extractBpmcsrf', () => {
	it('pulls BPMCSRF out of a multi-cookie header', () => {
		expect(extractBpmcsrf('.ASPXAUTH=sess; BPMCSRF=tok-123; UserName=x')).toBe('tok-123');
	});

	it('trims surrounding whitespace between cookie parts', () => {
		expect(extractBpmcsrf('BPMCSRF=abc ;  .ASPXAUTH=sess')).toBe('abc');
	});

	it('returns undefined when BPMCSRF is absent', () => {
		expect(extractBpmcsrf('.ASPXAUTH=sess; UserName=x')).toBeUndefined();
	});
});

describe('buildCookieHeaders', () => {
	it('emits Cookie + BPMCSRF + ForceUseSession on top of the base headers', () => {
		const headers = buildCookieHeaders('application/json', true, 'BPMCSRF=tok; .ASPXAUTH=sess', 'tok');
		expect(headers.Accept).toBe('application/json');
		expect(headers['Content-Type']).toBe('application/json');
		expect(headers.Cookie).toBe('BPMCSRF=tok; .ASPXAUTH=sess');
		expect(headers.BPMCSRF).toBe('tok');
		expect(headers.ForceUseSession).toBe('true');
	});

	it('omits the BPMCSRF header when no token is supplied', () => {
		const headers = buildCookieHeaders('application/xml', false, '.ASPXAUTH=sess');
		expect(headers.Cookie).toBe('.ASPXAUTH=sess');
		expect(headers.ForceUseSession).toBe('true');
		expect('BPMCSRF' in headers).toBe(false);
		expect('Content-Type' in headers).toBe(false);
	});
});
