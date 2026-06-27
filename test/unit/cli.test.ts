import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCliEnv, parseArgs, setEnvIfDefined } from '../../src/cli';

describe('parseArgs', () => {
	it('parses --key value pairs', () => {
		expect(parseArgs(['--base-url', 'https://x', '--login', 'admin'])).toEqual({
			'base-url': 'https://x',
			login: 'admin',
		});
	});

	it('parses --key=value pairs', () => {
		expect(parseArgs(['--base-url=https://x', '--readonly=true'])).toEqual({
			'base-url': 'https://x',
			readonly: 'true',
		});
	});

	it('treats a flag with no value as true', () => {
		expect(parseArgs(['--verbose'])).toEqual({ verbose: 'true' });
	});

	it('recognizes -h / --help', () => {
		expect(parseArgs(['-h']).help).toBe('true');
		expect(parseArgs(['--help']).help).toBe('true');
	});

	it('ignores non-option tokens', () => {
		expect(parseArgs(['positional', '--login', 'admin'])).toEqual({ login: 'admin' });
	});
});

describe('setEnvIfDefined / applyCliEnv', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('sets the env var only for non-empty values', () => {
		setEnvIfDefined('TEST_CLI_VAR', 'value');
		expect(process.env.TEST_CLI_VAR).toBe('value');
		setEnvIfDefined('TEST_CLI_VAR_2', undefined);
		expect(process.env.TEST_CLI_VAR_2).toBeUndefined();
		delete process.env.TEST_CLI_VAR;
	});

	it('maps CLI options to CREATIO_* env vars', () => {
		applyCliEnv({
			'base-url': 'https://tenant.creatio.local',
			login: 'admin',
			password: 'secret',
			readonly: 'true',
		});
		expect(process.env.CREATIO_BASE_URL).toBe('https://tenant.creatio.local');
		expect(process.env.CREATIO_LOGIN).toBe('admin');
		expect(process.env.CREATIO_PASSWORD).toBe('secret');
		expect(process.env.CREATIO_MCP_READONLY).toBe('true');
		delete process.env.CREATIO_BASE_URL;
		delete process.env.CREATIO_LOGIN;
		delete process.env.CREATIO_PASSWORD;
		delete process.env.CREATIO_MCP_READONLY;
	});
});
