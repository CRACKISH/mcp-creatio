import {
	AuthProviderType,
	CreatioClientAuthConfig,
	CreatioClientConfig,
	LegacyAuthConfig,
	OAuth2AuthConfig,
	OAuth2CodeAuthConfig,
} from './creatio';
import { env } from './utils';

function getCreatioClientAuthConfig(): CreatioClientAuthConfig {
	const codeConf = _getOAuth2CodeAuthConfig();
	if (codeConf) {
		return codeConf;
	}
	const oauth2Conf = _getOAuth2AuthConfig();
	if (oauth2Conf) {
		return oauth2Conf;
	}
	const legacyConf = _getLegacyAuthConfig();
	if (legacyConf) {
		return legacyConf;
	}
	throw new Error(
		'You must set either CREATIO_CODE_* (client id, client secret, redirect, scope) or CREATIO_CLIENT_ID/CREATIO_CLIENT_SECRET, or both CREATIO_LOGIN and CREATIO_PASSWORD',
	);
}

function _getOAuth2CodeAuthConfig(): OAuth2CodeAuthConfig | null {
	const codeClientId = env('CREATIO_CODE_CLIENT_ID');
	const codeClientSecret = env('CREATIO_CODE_CLIENT_SECRET');
	const codeRedirectUri = env('CREATIO_CODE_REDIRECT_URI');
	const codeScope = env('CREATIO_CODE_SCOPE');
	if (codeClientId && codeClientSecret && codeRedirectUri && codeScope) {
		return {
			kind: AuthProviderType.OAuth2Code,
			clientId: codeClientId,
			clientSecret: codeClientSecret,
			redirectUri: codeRedirectUri,
			scope: codeScope,
		};
	}
	return null;
}

function _getOAuth2AuthConfig(): OAuth2AuthConfig | null {
	const clientId = env('CREATIO_CLIENT_ID');
	const clientSecret = env('CREATIO_CLIENT_SECRET');
	if (clientId && clientSecret) {
		const conf: OAuth2AuthConfig = { kind: AuthProviderType.OAuth2, clientId, clientSecret };
		const idb = env('CREATIO_ID_BASE_URL');
		if (idb) {
			conf.idBaseUrl = idb;
		}
		return conf;
	}
	return null;
}

function _getLegacyAuthConfig(): LegacyAuthConfig | null {
	const login = env('CREATIO_LOGIN');
	const password = env('CREATIO_PASSWORD');
	if (login && password) {
		return { kind: AuthProviderType.Legacy, login, password };
	}
	return null;
}

export function getCreatioClientConfig(): CreatioClientConfig {
	const baseUrl = env('CREATIO_BASE_URL');
	if (!baseUrl) {
		throw new Error('Environment variable CREATIO_BASE_URL is required but not set');
	}
	const auth = getCreatioClientAuthConfig();
	return { baseUrl, auth };
}
