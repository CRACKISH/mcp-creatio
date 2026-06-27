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
