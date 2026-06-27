import { AuthProviderType, BearerAuthMode } from './auth/providers';

interface ICreatioAuthConfig {
	kind: AuthProviderType;
}

export interface LegacyAuthConfig extends ICreatioAuthConfig {
	kind: AuthProviderType.Legacy;
	login: string;
	password: string;
}

interface BaseOAuthConfig extends ICreatioAuthConfig {
	clientId: string;
	clientSecret: string;
	scope?: string;
	idBaseUrl?: string;
}

export interface OAuth2AuthConfig extends BaseOAuthConfig {
	kind: AuthProviderType.OAuth2;
}

/**
 * Stateless per-request Bearer passthrough. Carries no credentials of its own — the token arrives
 * on each request (delegated: from the client; gateway: injected by the Control-Plane).
 */
export interface BearerAuthConfig extends ICreatioAuthConfig {
	kind: AuthProviderType.OAuth2Bearer;
	mode: BearerAuthMode;
	/** Identity Service base advertised in delegated discovery; defaults to deriving from baseUrl. */
	idBaseUrl?: string;
}

/**
 * Broker: the MCP is its own OAuth 2.1 authorization server for clients and brokers the user login
 * to Creatio via authorization_code + PKCE, holding the user's Creatio tokens server-side. Reuses
 * the Creatio OAuth app credentials; `jwtSecret` signs the tokens the MCP issues to its clients.
 */
export interface BrokerAuthConfig extends ICreatioAuthConfig {
	kind: AuthProviderType.Broker;
	clientId: string;
	/** Optional: public Creatio apps (`IsPublic=true`) use PKCE with no secret. */
	clientSecret?: string;
	scope?: string;
	idBaseUrl?: string;
	/** Secret used to sign/verify the access tokens the MCP issues to its OAuth clients. */
	jwtSecret: string;
}

export type CreatioClientAuthConfig =
	| LegacyAuthConfig
	| OAuth2AuthConfig
	| BearerAuthConfig
	| BrokerAuthConfig;

/**
 * Which Creatio data API backs the CRUD provider. Selected per-deployment (env), the same
 * shape as auth selection — one backend per process. `dataservice` is the default (Creatio's
 * native data API, the one the Freedom UI uses); `odata` is the alternative backend.
 */
export type CrudBackend = 'odata' | 'dataservice';

export interface CreatioClientConfig {
	baseUrl: string;
	auth: CreatioClientAuthConfig;
	/** Defaults to `dataservice` when omitted. */
	crudBackend?: CrudBackend;
}
