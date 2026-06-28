import { describe, expect, it, vi } from 'vitest';

import { AuthProviderType, BearerAuthMode } from '../../src/creatio';
import { createAuthEdge } from '../../src/server/http/auth-edge';
import { SessionContext } from '../../src/sessions/session-context';
import { resetSessionContext } from '../support/test-server';

import type { CreatioClientConfig } from '../../src/creatio';
import type { Express } from 'express';

function baseConfig(auth: unknown): CreatioClientConfig {
	return { baseUrl: 'https://t.creatio.local', auth } as unknown as CreatioClientConfig;
}

/** Fake Express app capturing route registrations. */
function fakeApp() {
	const gets: string[] = [];
	const posts: string[] = [];
	const app = {
		get: vi.fn((path: string) => {
			gets.push(path);
			return app;
		}),
		post: vi.fn((path: string) => {
			posts.push(path);
			return app;
		}),
	};
	return { app: app as unknown as Express, gets, posts };
}

const rateLimitFactory = vi.fn(() => (() => {}) as never);

describe('createAuthEdge', () => {
	it('returns undefined when there is no config or no auth', () => {
		expect(createAuthEdge(undefined, SessionContext.instance)).toBeUndefined();
		expect(createAuthEdge(baseConfig(undefined), SessionContext.instance)).toBeUndefined();
	});

	it('returns undefined for a non-bearer / non-broker auth kind (e.g. legacy)', () => {
		const edge = createAuthEdge(
			baseConfig({ kind: AuthProviderType.Legacy, login: 'u', password: 'p' }),
			SessionContext.instance,
		);
		expect(edge).toBeUndefined();
	});

	it('returns a BearerAuthEdge for delegated bearer and wires the bearer routes', () => {
		const edge = createAuthEdge(
			baseConfig({ kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Delegated }),
			SessionContext.instance,
		);
		expect(edge).toBeDefined();
		expect(typeof edge!.mcpAuth()).toBe('function');
		const { app } = fakeApp();
		edge!.registerRoutes(app, rateLimitFactory);
		// Bearer edge has no periodic cleanup.
		expect(edge!.cleanup).toBeUndefined();
	});

	it('returns a BearerAuthEdge for gateway bearer', () => {
		const edge = createAuthEdge(
			baseConfig({ kind: AuthProviderType.OAuth2Bearer, mode: BearerAuthMode.Gateway }),
			SessionContext.instance,
		);
		expect(edge).toBeDefined();
		expect(typeof edge!.mcpAuth()).toBe('function');
	});

	describe('broker', () => {
		const brokerConfig = baseConfig({
			kind: AuthProviderType.Broker,
			clientId: 'creatio-app',
			jwtSecret: 'a-secret',
		});

		it('returns a BrokerAuthEdge with a mcpAuth handler', () => {
			const edge = createAuthEdge(brokerConfig, SessionContext.instance);
			expect(edge).toBeDefined();
			expect(typeof edge!.mcpAuth()).toBe('function');
		});

		it('registerRoutes wires the OAuth metadata, register, authorize, callback, token, revoke routes', () => {
			const edge = createAuthEdge(brokerConfig, SessionContext.instance);
			const { app, gets, posts } = fakeApp();
			edge!.registerRoutes(app, rateLimitFactory);
			expect(gets).toEqual(
				expect.arrayContaining([
					'/.well-known/oauth-authorization-server',
					'/.well-known/oauth-protected-resource',
					'/authorize',
					'/oauth/callback',
				]),
			);
			expect(posts).toEqual(expect.arrayContaining(['/register', '/token', '/revoke']));
			// Rate-limited routes invoked the factory.
			expect(rateLimitFactory).toHaveBeenCalled();
		});

		it('cleanup invokes oauth + session maintenance without throwing', () => {
			resetSessionContext();
			const session = SessionContext.instance;
			const evictSpy = vi.spyOn(session, 'evictStaleTokens').mockResolvedValue(0);
			const edge = createAuthEdge(brokerConfig, session);
			expect(edge!.cleanup).toBeTypeOf('function');
			expect(() => edge!.cleanup!()).not.toThrow();
			expect(evictSpy).toHaveBeenCalled();
			evictSpy.mockRestore();
		});
	});
});
