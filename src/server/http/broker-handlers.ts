import { CreatioOAuthClient } from '../../creatio';
import log from '../../log';
import { SessionContext } from '../../sessions';
import { generatePkcePair } from '../../utils';
import { buildProtectedResourceMetadata, inspectBearer } from '../bearer';
import { OAuthServer, OAuthValidators } from '../oauth';

import { resolvePublicOrigin } from './public-origin';

import type { NextFunction, Request, Response } from 'express';

const PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

/** The public origin this AS advertises (honors CREATIO_MCP_PUBLIC_URL behind a proxy). */
function origin(req: Request): string {
	return resolvePublicOrigin(req);
}

/** RFC 8414 Authorization Server Metadata, built from the request origin (proxy-aware). */
function authServerMetadata(req: Request) {
	const base = origin(req);
	return {
		issuer: base,
		authorization_endpoint: `${base}/authorize`,
		token_endpoint: `${base}/token`,
		registration_endpoint: `${base}/register`,
		revocation_endpoint: `${base}/revoke`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
		code_challenge_methods_supported: ['S256'],
		scopes_supported: ['offline_access'],
	};
}

/** The `iss`/`aud` the tokens this server issues are bound to: its own origin and `/mcp` resource.
 *  Derived from the (proxy-aware) request so issue and validate always agree for this deployment. */
function tokenAudience(req: Request): { issuer: string; audience: string } {
	const base = origin(req);
	return { issuer: base, audience: `${base}/mcp` };
}

/**
 * Broker mode HTTP handlers: the MCP is its own OAuth 2.1 authorization server for clients and
 * brokers the user login to Creatio (authorization_code + PKCE). The MCP-client PKCE and our own
 * Creatio-leg PKCE are kept in separate fields (server-side {@link OAuthServer.createPendingAuthorization})
 * — nothing is embedded in the Creatio `state`, so the two never collide.
 */
export class BrokerHandlers {
	private readonly _callbackPath = '/oauth/callback';

	constructor(
		private readonly _oauth: OAuthServer,
		private readonly _creatio: CreatioOAuthClient,
		private readonly _session: SessionContext,
	) {}

	private _callbackUrl(req: Request): string {
		return `${origin(req)}${this._callbackPath}`;
	}

	/** RFC 6750 `401` challenge pointing at our protected-resource metadata. `invalid_token` tells a
	 *  client holding a now-unusable token to re-authenticate (vs. a plain "no credentials" prompt). */
	private _challenge(
		req: Request,
		res: Response,
		description: string,
		error: 'unauthorized' | 'invalid_token' = 'unauthorized',
	): void {
		const resourceMetadata = `${origin(req)}${PROTECTED_RESOURCE_METADATA_PATH}`;
		const params = [`Bearer resource_metadata="${resourceMetadata}"`];
		if (error === 'invalid_token') {
			params.push(`error="invalid_token"`, `error_description="${description}"`);
		}
		res.setHeader('WWW-Authenticate', params.join(', '));
		res.status(401).json({ error, error_description: description });
	}

	private _redirectError(
		res: Response,
		redirectUri: string,
		error: { error: string; error_description?: string },
		state: string | undefined,
	): void {
		const url = new URL(redirectUri);
		url.searchParams.set('error', error.error);
		if (error.error_description) {
			url.searchParams.set('error_description', error.error_description);
		}
		if (state) {
			url.searchParams.set('state', state);
		}
		res.redirect(302, url.toString());
	}

	public handleMetadata(req: Request, res: Response): void {
		res.json(authServerMetadata(req));
	}

	/** RFC 9728: in broker mode WE are the authorization server, so it points back at this origin. */
	public handleProtectedResourceMetadata(req: Request, res: Response): void {
		const base = origin(req);
		res.json(buildProtectedResourceMetadata(`${base}/mcp`, base));
	}

	/**
	 * Guards `/mcp`: validates the token THIS server issued, confirms we still hold the user's
	 * brokered Creatio tokens, and exposes the `userKey`. The Creatio tokens are kept in memory and
	 * are therefore lost on restart, while the token we issued (a stateless JWT) survives — so a
	 * reconnecting client looks authenticated but every Creatio call would fail. When the tokens are
	 * gone we answer `401` with `error="invalid_token"` so the client transparently re-runs OAuth.
	 */
	public mcpAuth() {
		return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
			const header = req.headers.authorization;
			const userKey = header?.startsWith('Bearer ')
				? this._oauth.validateAccessToken(header.slice(7), tokenAudience(req))
				: null;
			if (!userKey) {
				this._challenge(
					req,
					res,
					'Authorization required. Complete the OAuth flow to obtain a token.',
				);
				return;
			}
			if (!(await this._session.getTokensForUser(userKey))) {
				this._challenge(
					req,
					res,
					'Session expired; the server no longer holds your Creatio tokens. Re-authorize to continue.',
					'invalid_token',
				);
				return;
			}
			(req as Request & { userKey?: string }).userKey = userKey;
			next();
		};
	}

	public handleRegister(req: Request, res: Response): void {
		const { redirect_uris } = req.body ?? {};
		const error = OAuthValidators.validateClientRegistration(redirect_uris);
		if (error) {
			res.status(400).json({ error: 'invalid_request', error_description: error });
			return;
		}
		res.status(201).json(this._oauth.registerClient(redirect_uris));
	}

	public async handleAuthorize(req: Request, res: Response): Promise<void> {
		const q = req.query as Record<string, string | undefined>;
		const redirectUri = q.redirect_uri ?? '';
		if (!redirectUri || !OAuthValidators.isAllowedRedirectUri(redirectUri)) {
			res.status(400).json({
				error: 'invalid_request',
				error_description: 'Missing or disallowed redirect_uri',
			});
			return;
		}
		const params = {
			client_id: q.client_id ?? '',
			redirect_uri: redirectUri,
			response_type: q.response_type ?? '',
			code_challenge: q.code_challenge ?? '',
			code_challenge_method: q.code_challenge_method ?? '',
			...(q.state !== undefined ? { state: q.state } : {}),
			...(q.scope !== undefined ? { scope: q.scope } : {}),
		};
		const validationError = this._oauth.validateAuthorizationRequest(params);
		if (validationError) {
			return this._redirectError(res, redirectUri, validationError, q.state);
		}
		// Our own Creatio-leg PKCE, kept server-side (never mixed into the Creatio state).
		const { verifier, challenge } = await generatePkcePair();
		const brokerState = this._oauth.createPendingAuthorization({
			client_id: params.client_id,
			redirect_uri: redirectUri,
			code_challenge: params.code_challenge,
			code_challenge_method: params.code_challenge_method,
			client_state: q.state,
			creatio_verifier: verifier,
		});
		const creatioUrl = this._creatio.buildAuthorizeUrl(
			this._callbackUrl(req),
			brokerState,
			challenge,
		);
		res.redirect(302, creatioUrl);
	}

	public async handleCallback(req: Request, res: Response): Promise<void> {
		const code = String(req.query.code ?? '');
		const brokerState = String(req.query.state ?? '');
		if (!code || !brokerState) {
			res.status(400).send('Missing code or state');
			return;
		}
		const pending = this._oauth.takePendingAuthorization(brokerState);
		if (!pending) {
			res.status(400).send('Unknown or expired authorization state');
			return;
		}
		try {
			const tokens = await this._creatio.exchangeCode(
				code,
				this._callbackUrl(req),
				pending.creatio_verifier,
			);
			const userKey = inspectBearer(tokens.accessToken).userKey;
			await this._session.setTokensForUser(userKey, tokens);
			const mcpCode = this._oauth.generateAuthorizationCode(
				pending.client_id,
				pending.redirect_uri,
				pending.code_challenge,
				pending.code_challenge_method,
				userKey,
			);
			const target = new URL(pending.redirect_uri);
			target.searchParams.set('code', mcpCode);
			if (pending.client_state) {
				target.searchParams.set('state', pending.client_state);
			}
			res.redirect(302, target.toString());
		} catch (err: unknown) {
			log.error('broker.callback.error', { error: String((err as Error)?.message ?? err) });
			res.status(502).send('Failed to complete authorization with Creatio');
		}
	}

	public async handleToken(req: Request, res: Response): Promise<void> {
		const body = req.body ?? {};
		const aud = tokenAudience(req);
		const sessionStillHeld = (userKey: string): Promise<boolean> =>
			this._session.getTokensForUser(userKey).then(Boolean);
		const result =
			body.grant_type === 'refresh_token'
				? await this._oauth.exchangeRefreshToken(body, aud, sessionStillHeld)
				: await this._oauth.exchangeCodeForToken(body, aud);
		if ('error' in result) {
			res.status(400).json(result);
			return;
		}
		res.json(result);
	}

	/**
	 * RFC 7009 token revocation / logout: invalidate the user's brokered session. Resolve the user
	 * from the presented token, revoke their Creatio token upstream (best-effort), and purge the
	 * server-side Creatio tokens + our issued refresh tokens. Always answers 200 — even for an
	 * unknown token — so it is not a token-validity oracle.
	 */
	public async handleRevoke(req: Request, res: Response): Promise<void> {
		const token = String((req.body ?? {}).token ?? '');
		if (token) {
			const userKey = this._oauth.resolveUserFromToken(token, tokenAudience(req));
			if (userKey) {
				const stored = await this._session.getTokensForUser(userKey);
				if (stored?.refreshToken) {
					await this._creatio.revoke(stored.refreshToken);
				}
				await this._session.deleteTokensForUser(userKey);
				this._oauth.purgeRefreshTokensForUser(userKey);
				log.info('broker.revoke', { userKey });
			}
		}
		res.status(200).json({});
	}
}
