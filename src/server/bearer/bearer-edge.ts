import { BearerAuthConfig, BearerAuthMode } from '../../creatio';
import log from '../../log';
import { env, extractBpmcsrf, InjectedCredential } from '../../utils';
import { resolvePublicOrigin } from '../http/public-origin';

import { isAllowedBaseUrl, parseAllowedBaseUrls } from './base-url-guard';
import { inspectBearer, isExpired } from './bearer-token';

import type { Express, NextFunction, Request, Response } from 'express';

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
const BASE_URL_OVERRIDE_HEADER = 'x-creatio-base-url';
// Cookie passthrough (Forms-auth tenants without OAuth): the client/gateway forwards the Creatio
// session in a dedicated header (not the transport's own `Cookie`, which proxies mangle). BPMCSRF
// is read from the cookie string, or overridden by an explicit header.
const COOKIE_HEADER = 'x-creatio-cookie';
const BPMCSRF_HEADER = 'x-creatio-bpmcsrf';

/** RFC 9728 Protected Resource Metadata, advertising Creatio Identity as the authorization server. */
export function buildProtectedResourceMetadata(resource: string, identityBase: string) {
	return {
		resource,
		authorization_servers: [identityBase],
		scopes_supported: ['offline_access'],
		bearer_methods_supported: ['header'],
	};
}

/**
 * The HTTP "edge" for the stateless per-request Bearer model — the only place the two modes differ.
 *
 * - **gateway**: a trusted Control-Plane injects the Bearer (+ optional `X-Creatio-Base-Url` for
 *   multi-tenant routing); the MCP trusts it and passes it through.
 * - **delegated**: the client obtained the token directly from Creatio Identity; the MCP advertises
 *   that authorization server via RFC 9728, challenges unauthenticated requests, and fails fast on
 *   an obviously-expired JWT.
 *
 * Both modes are FULLY-TRUSTED-ENVIRONMENT deployments: gateway trusts the Control-Plane in front of
 * it; delegated trusts the client + the network it runs on. The MCP does NOT cryptographically
 * verify the Bearer here — Creatio remains the ultimate authority and independently rejects invalid
 * tokens on the API call — so the runtime is a straight token passthrough; only discovery/trust
 * differ. The `userKey` derived from the token is therefore an UNVERIFIED, session/logging-only
 * identity, not an authenticated principal. For an untrusted, direct external client that needs the
 * MCP itself to verify identity, use `broker` mode (the MCP is its own audience-bound OAuth 2.1 AS).
 */
export class BearerEdge {
	private readonly _config: BearerAuthConfig;
	private readonly _baseUrl: string;
	private readonly _allowedBaseUrls: string[];

	private get _isDelegated(): boolean {
		return this._config.mode === BearerAuthMode.Delegated;
	}

	/** Identity Service base advertised to clients. */
	private get _identityBase(): string {
		return this._config.idBaseUrl ?? `${this._baseUrl.replace(/\/$/, '')}/0`;
	}

	constructor(config: BearerAuthConfig, baseUrl: string) {
		this._config = config;
		this._baseUrl = baseUrl;
		this._allowedBaseUrls = parseAllowedBaseUrls(env('CREATIO_MCP_ALLOWED_BASE_URLS'));
	}

	/** Pull the per-request credential the client/gateway supplied: a Bearer token, or a forwarded
	 *  Creatio Forms-auth session (cookie + BPMCSRF). Returns undefined when neither is present. */
	private _extractCredential(req: Request): InjectedCredential | undefined {
		const auth = req.headers.authorization;
		if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
			return { kind: 'bearer', token: auth.slice(7) };
		}
		const cookie = req.headers[COOKIE_HEADER];
		if (typeof cookie === 'string' && cookie) {
			const explicitCsrf = req.headers[BPMCSRF_HEADER];
			const bpmcsrf =
				typeof explicitCsrf === 'string' && explicitCsrf ? explicitCsrf : extractBpmcsrf(cookie);
			return { kind: 'cookie', cookie, bpmcsrf };
		}
		return undefined;
	}

	private _accept(
		req: Request,
		credential: InjectedCredential,
		next: NextFunction,
		userKey?: string,
	): void {
		const r = req as Request & { userKey?: string; credential?: InjectedCredential };
		const resolvedUserKey =
			userKey ?? (credential.kind === 'bearer' ? inspectBearer(credential.token).userKey : undefined);
		if (resolvedUserKey !== undefined) {
			r.userKey = resolvedUserKey;
		}
		r.credential = credential;
		next();
	}

	private _challenge(req: Request, res: Response, reason: string): void {
		if (this._isDelegated) {
			const resourceMetadata = `${resolvePublicOrigin(req)}${PROTECTED_RESOURCE_METADATA_PATH}`;
			res.setHeader(
				'WWW-Authenticate',
				`Bearer resource_metadata="${resourceMetadata}", error="${reason}"`,
			);
		}
		res.status(401).json({
			error: 'unauthorized',
			error_description:
				reason === 'missing_token'
					? 'A Creatio credential is required: a Bearer token (Authorization) or a forwarded session (X-Creatio-Cookie).'
					: `Bearer token rejected: ${reason}.`,
		});
	}

	/** Delegated mode publishes RFC 9728 metadata so clients can discover the authorization server. */
	public registerRoutes(app: Express): void {
		if (!this._isDelegated) {
			return;
		}
		app.get(PROTECTED_RESOURCE_METADATA_PATH, (req: Request, res: Response) => {
			const resource = `${resolvePublicOrigin(req)}/mcp`;
			res.json(buildProtectedResourceMetadata(resource, this._identityBase));
		});
	}

	/** Express middleware guarding `/mcp`. Sets `req.credential` / `req.userKey` / `req.baseUrlOverride`. */
	public mcpAuth() {
		return (req: Request, res: Response, next: NextFunction): void => {
			const credential = this._extractCredential(req);
			if (!credential) {
				return this._challenge(req, res, 'missing_token');
			}

			if (!this._isDelegated) {
				// gateway: a per-request instance override is honored only here (from the trusted
				// gateway). Still validate it — the override decides where the credential is sent, so a
				// bad value is an SSRF / credential-redirection lever even from a trusted source (CWE-918).
				const baseOverride = req.headers[BASE_URL_OVERRIDE_HEADER];
				if (typeof baseOverride === 'string' && baseOverride) {
					if (!isAllowedBaseUrl(baseOverride, this._allowedBaseUrls)) {
						log.warn('bearer.base_url_override.rejected', { override: baseOverride });
						res.status(400).json({
							error: 'invalid_request',
							error_description: 'Disallowed X-Creatio-Base-Url override.',
						});
						return;
					}
					(req as Request & { baseUrlOverride?: string }).baseUrlOverride = baseOverride;
				}
				return this._accept(req, credential, next);
			}

			// delegated: fail fast on an obviously-expired JWT; Creatio validates the rest on the call.
			// A forwarded cookie session has no client-readable expiry, so it is accepted as-is.
			if (credential.kind === 'bearer') {
				const decoded = inspectBearer(credential.token);
				if (decoded.isJwt && isExpired(decoded)) {
					return this._challenge(req, res, 'token_expired');
				}
				return this._accept(req, credential, next, decoded.userKey);
			}
			return this._accept(req, credential, next);
		};
	}
}
