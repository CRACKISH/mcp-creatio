import crypto from 'crypto';

import log from '../../log';

import type { OAuthClient } from './types';

/**
 * Handles OAuth client auto-registration based on common MCP patterns
 */
export class OAuthClientManager {
	/**
	 * Auto-register client if needed based on common MCP client patterns
	 */
	public static autoRegisterClient(client_id: string, redirect_uri: string): OAuthClient {
		// Auto-register based on common MCP client patterns
		let clientName = 'Unknown MCP Client';
		const redirectUris = [redirect_uri];

		// Try to identify known clients
		if (client_id.includes('claude')) {
			clientName = 'Claude Desktop';
		} else if (client_id.includes('vscode')) {
			clientName = 'VS Code';
		} else if (client_id.includes('cursor')) {
			clientName = 'Cursor';
		}

		const client: OAuthClient = {
			client_id,
			redirect_uris: redirectUris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			created_at: Date.now(),
		};

		log.info('oauth.client.auto_registered', {
			client_id,
			client_name: clientName,
			redirect_uris: redirectUris,
		});

		return client;
	}

	/**
	 * Create a new client with provided redirect URIs
	 */
	public static createClient(redirect_uris: string[]): OAuthClient {
		const client_id = crypto.randomUUID();
		const client: OAuthClient = {
			client_id,
			redirect_uris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none', // Public client
			created_at: Date.now(),
		};

		log.info('oauth.client.registered', { client_id, redirect_uris });
		return client;
	}
}
