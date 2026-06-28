import { AuthProviderType, CreatioOAuthClient } from '../../creatio';
import { SessionContext } from '../../sessions';
import { BearerEdge } from '../bearer';
import { OAuthServer } from '../oauth';

import { BrokerHandlers } from './broker-handlers';

import type { BearerAuthConfig, BrokerAuthConfig, CreatioClientConfig } from '../../creatio';
import type { Express, RequestHandler } from 'express';

export interface RateLimitOptions {
	windowMs: number;
	max: number;
}
export type RateLimitFactory = (options: RateLimitOptions) => RequestHandler;

/**
 * The HTTP auth strategy for the `/mcp` surface: a guard middleware, the mode-specific discovery /
 * OAuth routes, and optional periodic cleanup. Extracting this keeps {@link HttpServer} from
 * branching on `auth.kind` (and from owning the `config!`/`as` casts) — it just consumes a strategy.
 */
export interface AuthEdge {
	mcpAuth(): RequestHandler;
	registerRoutes(app: Express, rateLimit: RateLimitFactory): void;
	/** Periodic maintenance (e.g. evict expired broker codes/tokens); omitted when there is none. */
	cleanup?(): void;
}

/** Stateless per-request Bearer edge (delegated / gateway). */
class BearerAuthEdge implements AuthEdge {
	constructor(private readonly _edge: BearerEdge) {}

	public mcpAuth(): RequestHandler {
		return this._edge.mcpAuth();
	}

	public registerRoutes(app: Express): void {
		this._edge.registerRoutes(app);
	}
}

/** Broker edge: the MCP's own OAuth 2.1 AS + the brokered Creatio login. */
class BrokerAuthEdge implements AuthEdge {
	// Per-route fixed-window limits (per IP) for the unauthenticated broker OAuth surface.
	private static readonly RL_AUTH_FLOW = { windowMs: 60_000, max: 60 };
	private static readonly RL_TOKEN = { windowMs: 60_000, max: 30 };
	private static readonly RL_REGISTER = { windowMs: 60_000, max: 10 };

	constructor(
		private readonly _handlers: BrokerHandlers,
		private readonly _oauth: OAuthServer,
		private readonly _session: SessionContext,
	) {}

	public mcpAuth(): RequestHandler {
		return this._handlers.mcpAuth();
	}

	public registerRoutes(app: Express, rateLimit: RateLimitFactory): void {
		const h = this._handlers;
		app.get('/.well-known/oauth-authorization-server', (q, s) => h.handleMetadata(q, s));
		app.get('/.well-known/oauth-protected-resource', (q, s) =>
			h.handleProtectedResourceMetadata(q, s),
		);
		app.post('/register', rateLimit(BrokerAuthEdge.RL_REGISTER), (q, s) =>
			h.handleRegister(q, s),
		);
		app.get('/authorize', rateLimit(BrokerAuthEdge.RL_AUTH_FLOW), (q, s) =>
			h.handleAuthorize(q, s),
		);
		app.get('/oauth/callback', rateLimit(BrokerAuthEdge.RL_AUTH_FLOW), (q, s) =>
			h.handleCallback(q, s),
		);
		app.post('/token', rateLimit(BrokerAuthEdge.RL_TOKEN), (q, s) => h.handleToken(q, s));
		app.post('/revoke', rateLimit(BrokerAuthEdge.RL_TOKEN), (q, s) => h.handleRevoke(q, s));
	}

	public cleanup(): void {
		// Broker keeps transient state (codes, pending auths, user tokens) — keep the maps bounded.
		this._oauth.cleanup();
		void this._session.evictStaleTokens();
	}
}

/**
 * Build the auth edge for the configured mode, or `undefined` when no `/mcp` auth applies
 * (e.g. a single-identity stdio-style config served over HTTP). The one place that maps an auth
 * config to its HTTP strategy.
 */
export function createAuthEdge(
	config: CreatioClientConfig | undefined,
	session: SessionContext,
): AuthEdge | undefined {
	const auth = config?.auth;
	if (!auth || !config) {
		return undefined;
	}
	if (auth.kind === AuthProviderType.OAuth2Bearer) {
		return new BearerAuthEdge(new BearerEdge(auth as BearerAuthConfig, config.baseUrl));
	}
	if (auth.kind === AuthProviderType.Broker) {
		const brokerAuth = auth as BrokerAuthConfig;
		const oauth = new OAuthServer(brokerAuth.jwtSecret);
		const handlers = new BrokerHandlers(
			oauth,
			new CreatioOAuthClient(config.baseUrl, brokerAuth),
			session,
		);
		return new BrokerAuthEdge(handlers, oauth, session);
	}
	return undefined;
}
