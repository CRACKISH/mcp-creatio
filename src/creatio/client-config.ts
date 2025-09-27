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

export interface CreatioClientConfig {
	baseUrl: string;
	auth: CreatioClientAuthConfig;
}
