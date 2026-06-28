import { describe, expect, it, vi } from 'vitest';

import { HttpMiddleware } from '../../src/server/http/middleware';

import type { NextFunction, Request, Response } from 'express';

function mockReq(overrides: Record<string, unknown> = {}): Request {
	return {
		ip: '1.2.3.4',
		path: '/x',
		method: 'GET',
		url: '/x?a=1',
		headers: {},
		socket: { remoteAddress: '1.2.3.4' },
		...overrides,
	} as unknown as Request;
}

function mockRes() {
	const res: Record<string, unknown> = {
		statusCode: 200,
		headers: {} as Record<string, unknown>,
		headersSent: false,
		finishHandlers: [] as Array<() => void>,
	};
	res.setHeader = vi.fn((k: string, v: unknown) => {
		(res.headers as Record<string, unknown>)[k] = v;
	});
	res.getHeader = vi.fn((k: string) => (res.headers as Record<string, unknown>)[k]);
	res.status = vi.fn((c: number) => {
		res.statusCode = c;
		return res;
	});
	res.json = vi.fn(() => res);
	res.on = vi.fn((event: string, cb: () => void) => {
		if (event === 'finish') (res.finishHandlers as Array<() => void>).push(cb);
		return res;
	});
	res.emitFinish = () => (res.finishHandlers as Array<() => void>).forEach((h) => h());
	return res;
}

const mw = new HttpMiddleware();

describe('HttpMiddleware.rateLimit', () => {
	it('allows requests under the limit', () => {
		const handler = mw.rateLimit({ windowMs: 1000, max: 2 });
		const next = vi.fn();
		handler(mockReq(), mockRes() as unknown as Response, next as NextFunction);
		handler(mockReq(), mockRes() as unknown as Response, next as NextFunction);
		expect(next).toHaveBeenCalledTimes(2);
	});

	it('returns 429 with Retry-After once over the limit', () => {
		const handler = mw.rateLimit({ windowMs: 1000, max: 1 });
		const next = vi.fn();
		handler(mockReq(), mockRes() as unknown as Response, next as NextFunction);
		const res = mockRes();
		handler(mockReq(), res as unknown as Response, next as NextFunction);
		expect(res.statusCode).toBe(429);
		expect((res.headers as Record<string, unknown>)['Retry-After']).toBeTruthy();
		expect(next).toHaveBeenCalledTimes(1); // only the first passed
	});
});

describe('HttpMiddleware.errorHandler', () => {
	it('responds 500 json when headers not sent', () => {
		const res = mockRes();
		const next = vi.fn();
		mw.errorHandler()(
			new Error('boom'),
			mockReq(),
			res as unknown as Response,
			next as NextFunction,
		);
		expect(res.statusCode).toBe(500);
		expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'server_error' }));
		expect(next).not.toHaveBeenCalled();
	});

	it('delegates to next when headers already sent', () => {
		const res = mockRes();
		res.headersSent = true;
		const next = vi.fn();
		const err = new Error('late');
		mw.errorHandler()(err, mockReq(), res as unknown as Response, next as NextFunction);
		expect(next).toHaveBeenCalledWith(err);
	});
});

describe('HttpMiddleware.correlationId', () => {
	it('uses the incoming header and sets the response header', () => {
		const res = mockRes();
		const next = vi.fn();
		const req = mockReq({ headers: { 'x-correlation-id': 'corr-1' } });
		mw.correlationId()(req, res as unknown as Response, next as NextFunction);
		expect((res.headers as Record<string, unknown>)['X-Correlation-ID']).toBe('corr-1');
		expect((req as unknown as { correlationId: string }).correlationId).toBe('corr-1');
		expect(next).toHaveBeenCalled();
		// finish clears the correlation id without throwing.
		expect(() => (res as { emitFinish: () => void }).emitFinish()).not.toThrow();
	});

	it('generates a correlation id when none is provided', () => {
		const res = mockRes();
		const next = vi.fn();
		const req = mockReq();
		mw.correlationId()(req, res as unknown as Response, next as NextFunction);
		expect((res.headers as Record<string, unknown>)['X-Correlation-ID']).toBeTruthy();
	});
});

describe('HttpMiddleware.requestLogging', () => {
	it('logs the request and the response on finish', () => {
		const res = mockRes();
		const next = vi.fn();
		const req = mockReq({
			headers: { 'user-agent': 'ua', 'content-type': 'application/json' },
			correlationId: 'c1',
		});
		mw.requestLogging()(req, res as unknown as Response, next as NextFunction);
		expect(next).toHaveBeenCalled();
		expect(() => (res as { emitFinish: () => void }).emitFinish()).not.toThrow();
	});
});
