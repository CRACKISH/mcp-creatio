import { describe, expect, it } from 'vitest';

import { challengeS256, generateCodeVerifier, generatePkcePair } from '../../src/utils/pkce';

// RFC 7636 Appendix B known vector.
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('pkce', () => {
	it('generateCodeVerifier produces a base64url string of the configured length', () => {
		const v = generateCodeVerifier();
		// 32 random bytes → 43 base64url chars (no padding), all in the unreserved set.
		expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
		expect(v.length).toBeGreaterThanOrEqual(43);
	});

	it('generateCodeVerifier honors a custom length and stays charset-clean', () => {
		const v = generateCodeVerifier(64);
		expect(v).toMatch(/^[A-Za-z0-9\-_]+$/);
		// 64 bytes → ~86 chars; longer than the 32-byte default.
		expect(v.length).toBeGreaterThan(64);
	});

	it('challengeS256 matches the RFC 7636 known vector', async () => {
		expect(await challengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
	});

	it('generatePkcePair returns a verifier whose S256 challenge matches', async () => {
		const { verifier, challenge } = await generatePkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
		expect(challenge).toBe(await challengeS256(verifier));
	});
});
