import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../src/utils/env';

afterEach(() => vi.unstubAllEnvs());

describe('env backward-compatible aliases', () => {
	it('prefers the canonical name over a legacy alias', () => {
		vi.stubEnv('CREATIO_MCP_READONLY', 'true');
		vi.stubEnv('READONLY_MODE', 'false');
		expect(env('CREATIO_MCP_READONLY')).toBe('true');
	});

	it('falls back to a legacy alias when the canonical name is unset', () => {
		vi.stubEnv('CREATIO_MCP_READONLY', '');
		vi.stubEnv('READONLY_MODE', 'true');
		expect(env('CREATIO_MCP_READONLY')).toBe('true');
	});

	it('honors PORT as a silent (non-deprecated) alias for CREATIO_MCP_PORT', () => {
		const writes: string[] = [];
		const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => {
			writes.push(String(s));
			return true;
		}) as never);
		vi.stubEnv('CREATIO_MCP_PORT', '');
		vi.stubEnv('PORT', '4000');
		expect(env('CREATIO_MCP_PORT')).toBe('4000');
		expect(writes.join('')).not.toMatch(/deprecated/i);
		spy.mockRestore();
	});

	it('emits a one-time deprecation notice when a deprecated alias is used', () => {
		const writes: string[] = [];
		const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((s: string) => {
			writes.push(String(s));
			return true;
		}) as never);
		vi.stubEnv('CREATIO_MCP_ENABLE_PUBLISHED_TOOLS', '');
		vi.stubEnv('ENABLE_PUBLISHED_TOOLS', 'true');
		env('CREATIO_MCP_ENABLE_PUBLISHED_TOOLS');
		env('CREATIO_MCP_ENABLE_PUBLISHED_TOOLS'); // second read must NOT warn again
		const notices = writes.filter((w) => /ENABLE_PUBLISHED_TOOLS.*deprecated|deprecated.*ENABLE_PUBLISHED_TOOLS/i.test(w));
		expect(notices.length).toBe(1);
		expect(writes.join('')).toContain('CREATIO_MCP_ENABLE_PUBLISHED_TOOLS');
		spy.mockRestore();
	});
});
