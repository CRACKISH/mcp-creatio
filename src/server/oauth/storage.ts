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

export interface StateData {
	client_id: string;
	expires_at: number;
}

export class OAuthStorage {
	private readonly _clients = new Map<string, OAuthClient>();
	private readonly _authorizationCodes = new Map<string, AuthorizationCodeData>();
	private readonly _authorizationStates = new Map<string, StateData>();

	public addClient(client: OAuthClient): void {
		this._clients.set(client.client_id, client);
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

	public storeState(
		state: string,
		client_id: string,
		expiresInMs: number = 30 * 60 * 1000,
	): void {
		const expires_at = Date.now() + expiresInMs;
		this._authorizationStates.set(state, { client_id, expires_at });
	}

	public getState(state: string): StateData | undefined {
		return this._authorizationStates.get(state);
	}

	public deleteState(state: string): void {
		this._authorizationStates.delete(state);
	}

	public getAllStates(): string[] {
		return Array.from(this._authorizationStates.keys());
	}

	public getAllStoredCodes(): string[] {
		return Array.from(this._authorizationCodes.keys());
	}

	public cleanup(): void {
		const now = Date.now();
		for (const [code, data] of this._authorizationCodes.entries()) {
			if (now > data.expires_at) {
				this._authorizationCodes.delete(code);
			}
		}
		for (const [state, data] of this._authorizationStates.entries()) {
			if (now > data.expires_at) {
				this._authorizationStates.delete(state);
			}
		}
		log.info('oauth.storage.cleanup.completed', {
			remaining_codes: this._authorizationCodes.size,
			remaining_states: this._authorizationStates.size,
		});
	}
}
