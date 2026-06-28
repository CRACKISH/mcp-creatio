import log from '../../log';

import type { OAuthClient } from './types';

export interface AuthorizationCodeData {
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: string;
	userKey: string;
	expires_at: number;
}

/**
 * A brokered authorization in flight between `/authorize` and `/oauth/callback`. It links the MCP
 * client's request (its redirect + PKCE + state) to our own Creatio-leg PKCE verifier, keyed by an
 * opaque broker state. Kept server-side ON PURPOSE — nothing is embedded in the Creatio `state`
 * string, so the two PKCE pairs never collide.
 */
export interface PendingAuthorizationData {
	client_id: string;
	/** The MCP client's redirect URI (where we send our code at the end). */
	redirect_uri: string;
	/** The MCP client's PKCE challenge (verified later at /token). */
	code_challenge: string;
	code_challenge_method: string;
	/** The MCP client's state, echoed back to it. */
	client_state?: string | undefined;
	/** Our Creatio-leg PKCE verifier, used to exchange the Creatio code in the callback. */
	creatio_verifier: string;
	expires_at: number;
}

/** A refresh token the broker issued to a client, bound to the user it represents and the client
 *  it was issued to (so a stolen token can't be redeemed by a different client). Single-use:
 *  rotated on every refresh. */
export interface RefreshTokenData {
	userKey: string;
	client_id: string;
	expires_at: number;
}

export class OAuthStorage {
	// Dynamically-registered clients are unauthenticated (open DCR), so the store is bounded by TTL
	// + a hard cap, evicting the oldest, to deny a memory-exhaustion DoS via IP-rotating /register.
	private static readonly CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
	private static readonly MAX_CLIENTS = 1000;
	private static readonly REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

	private readonly _clients = new Map<string, OAuthClient>();
	private readonly _authorizationCodes = new Map<string, AuthorizationCodeData>();
	private readonly _pendingAuthorizations = new Map<string, PendingAuthorizationData>();
	private readonly _refreshTokens = new Map<string, RefreshTokenData>();

	private _evictExpired(map: Map<string, { expires_at: number }>, now: number): void {
		for (const [key, data] of map.entries()) {
			if (now > data.expires_at) {
				map.delete(key);
			}
		}
	}

	private _evictExpiredClients(now: number): void {
		for (const [id, client] of this._clients.entries()) {
			if (now - client.created_at > OAuthStorage.CLIENT_TTL_MS) {
				this._clients.delete(id);
			}
		}
		this._capClients();
	}

	/** Hard-cap the client store, evicting the oldest (insertion order ~ creation order). */
	private _capClients(): void {
		while (this._clients.size > OAuthStorage.MAX_CLIENTS) {
			const oldest = this._clients.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this._clients.delete(oldest);
		}
	}

	public addClient(client: OAuthClient): void {
		this._clients.set(client.client_id, client);
		this._capClients();
	}

	public getClient(client_id: string): OAuthClient | undefined {
		return this._clients.get(client_id);
	}

	public hasClient(client_id: string): boolean {
		return this._clients.has(client_id);
	}

	public storeAuthorizationCode(
		code: string,
		client_id: string,
		redirect_uri: string,
		code_challenge: string,
		code_challenge_method: string,
		userKey: string,
		expiresInMs: number = 10 * 60 * 1000,
	): void {
		const expires_at = Date.now() + expiresInMs;
		this._authorizationCodes.set(code, {
			client_id,
			redirect_uri,
			code_challenge,
			code_challenge_method,
			userKey,
			expires_at,
		});
	}

	public getAuthorizationCode(code: string): AuthorizationCodeData | undefined {
		return this._authorizationCodes.get(code);
	}

	public deleteAuthorizationCode(code: string): void {
		this._authorizationCodes.delete(code);
	}

	public storePendingAuthorization(
		brokerState: string,
		data: Omit<PendingAuthorizationData, 'expires_at'>,
		expiresInMs: number = 10 * 60 * 1000,
	): void {
		this._pendingAuthorizations.set(brokerState, {
			...data,
			expires_at: Date.now() + expiresInMs,
		});
	}

	/** Returns and removes the pending authorization (single-use), or `undefined` if absent/expired. */
	public takePendingAuthorization(brokerState: string): PendingAuthorizationData | undefined {
		const data = this._pendingAuthorizations.get(brokerState);
		if (!data) {
			return undefined;
		}
		this._pendingAuthorizations.delete(brokerState);
		return Date.now() > data.expires_at ? undefined : data;
	}

	public storeRefreshToken(
		token: string,
		userKey: string,
		client_id: string,
		expiresInMs: number = OAuthStorage.REFRESH_TOKEN_TTL_MS,
	): void {
		this._refreshTokens.set(token, {
			userKey,
			client_id,
			expires_at: Date.now() + expiresInMs,
		});
	}

	/** Returns the refresh-token record, or `undefined` if absent/expired (expired ones are pruned). */
	public getRefreshToken(token: string): RefreshTokenData | undefined {
		const data = this._refreshTokens.get(token);
		if (!data) {
			return undefined;
		}
		if (Date.now() > data.expires_at) {
			this._refreshTokens.delete(token);
			return undefined;
		}
		return data;
	}

	public deleteRefreshToken(token: string): void {
		this._refreshTokens.delete(token);
	}

	public cleanup(): void {
		const now = Date.now();
		this._evictExpired(this._authorizationCodes, now);
		this._evictExpired(this._pendingAuthorizations, now);
		this._evictExpired(this._refreshTokens, now);
		this._evictExpiredClients(now);
		log.info('oauth.storage.cleanup.completed', {
			remaining_codes: this._authorizationCodes.size,
			remaining_pending: this._pendingAuthorizations.size,
			remaining_refresh: this._refreshTokens.size,
			remaining_clients: this._clients.size,
		});
	}
}
