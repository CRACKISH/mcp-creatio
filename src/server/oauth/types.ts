export interface OAuthClient {
	client_id: string;
	client_secret?: string;
	redirect_uris: string[];
	grant_types: string[];
	response_types?: string[];
	token_endpoint_auth_method?: string;
	created_at: number;
}

export interface OAuthAuthorizationRequest {
	client_id: string;
	redirect_uri: string;
	response_type: string;
	state?: string;
	code_challenge: string;
	code_challenge_method: string;
	scope?: string;
}

export interface OAuthTokenRequest {
	grant_type: string;
	client_id: string;
	code?: string;
	redirect_uri?: string;
	code_verifier?: string;
	refresh_token?: string;
}

export interface OAuthAccessToken {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	refresh_token?: string;
	scope?: string;
	userKey: string;
}

export interface OAuthError {
	error: string;
	error_description?: string;
	error_uri?: string;
}

export interface OAuthAuthorizationServerMetadata {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	registration_endpoint: string;
	response_types_supported: string[];
	grant_types_supported: string[];
	token_endpoint_auth_methods_supported: string[];
	code_challenge_methods_supported: string[];
	scopes_supported?: string[];
}
