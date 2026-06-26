import { afterEach, describe, expect, it, vi } from 'vitest';

import log from '../../src/log';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	log.clearCorrelationId();
});

describe('log level gating', () => {
	it('logs nothing when silent (default)', () => {
		vi.stubEnv('MCP_CREATIO_LOG_LEVEL', 'silent');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		log.info('hi');
		log.error('boom');
		expect(out).not.toHaveBeenCalled();
		expect(err).not.toHaveBeenCalled();
	});

	it('logs info/warn/error at info level', () => {
		vi.stubEnv('MCP_CREATIO_LOG_LEVEL', 'info');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		log.info('i');
		log.warn('w');
		log.error('e');
		expect(out).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(err).toHaveBeenCalledTimes(1);
	});

	it('logs only errors at error level', () => {
		vi.stubEnv('MCP_CREATIO_LOG_LEVEL', 'error');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		log.info('i');
		log.error('e');
		expect(out).not.toHaveBeenCalled();
		expect(err).toHaveBeenCalledTimes(1);
	});

	it('includes the correlation id and structured meta in the payload', () => {
		vi.stubEnv('MCP_CREATIO_LOG_LEVEL', 'info');
		const out = vi.spyOn(console, 'log').mockImplementation(() => {});
		log.setCorrelationId('corr-123');
		log.httpStart(3000, { extra: 'x' });
		const line = out.mock.calls[0]![0] as string;
		const parsed = JSON.parse(line);
		expect(parsed.correlationId).toBe('corr-123');
		expect(parsed.msg).toBe('http.server.start');
		expect(parsed.meta.port).toBe(3000);
	});

	it('routes to stderr when stderr-only mode is enabled', () => {
		vi.stubEnv('MCP_CREATIO_LOG_LEVEL', 'info');
		const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
		log.useStderrOnlyLogs();
		log.info('to-stderr');
		expect(stderr).toHaveBeenCalled();
	});
});
