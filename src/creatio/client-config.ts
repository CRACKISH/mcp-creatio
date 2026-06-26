import { AuthProviderType } from './auth/providers';

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

export interface OAuth2CodeAuthConfig extends BaseOAuthConfig {
	kind: AuthProviderType.OAuth2Code;
	redirectUri: string;
}

export type CreatioClientAuthConfig = LegacyAuthConfig | OAuth2AuthConfig | OAuth2CodeAuthConfig;

/**
 * Which Creatio data API backs the CRUD provider. Selected per-deployment (env), the
 * same shape as auth selection — one backend per process. `odata` is the default and
 * the only fully-implemented backend today; `dataservice` is reserved for the planned
 * DataService provider.
 */
export type CrudBackend = 'odata' | 'dataservice';

export interface CreatioClientConfig {
	baseUrl: string;
	auth: CreatioClientAuthConfig;
	/** Defaults to `odata` when omitted. */
	crudBackend?: CrudBackend;
}
