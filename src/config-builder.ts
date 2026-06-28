import crypto from 'node:crypto';

import {
	AuthProviderType,
	BearerAuthConfig,
	BearerAuthMode,
	BrokerAuthConfig,
	CreatioClientAuthConfig,
	CreatioClientConfig,
	CrudBackend,
	LegacyAuthConfig,
	OAuth2AuthConfig,
} from './creatio';
import log from './log';
import { env } from './utils';

/**
 * The single user-facing auth selector (`CREATIO_MCP_AUTH_MODE`). When unset it is INFERRED from
 * the supplied credentials (see {@link resolveAuthConfig}); `delegated`/`gateway` need none.
 */
const AUTH_MODES = ['delegated', 'gateway', 'broker', 'client_credentials', 'legacy'] as const;
type AuthMode = (typeof AUTH_MODES)[number];

const MISSING_CLIENT_CREDENTIALS =
	'client_credentials auth requires CREATIO_CLIENT_ID and CREATIO_CLIENT_SECRET';
const MISSING_LEGACY = 'legacy auth requires CREATIO_LOGIN and CREATIO_PASSWORD';
const MISSING_BROKER = 'broker auth requires CREATIO_CLIENT_ID';

function readExplicitMode(): AuthMode | undefined {
	const raw = env('CREATIO_MCP_AUTH_MODE')?.toLowerCase();
	if (!raw) {
		return undefined;
	}
	if ((AUTH_MODES as readonly string[]).includes(raw)) {
		return raw as AuthMode;
	}
	throw new Error(`unsupported_auth_mode:${raw} (expected one of ${AUTH_MODES.join(', ')})`);
}

/**
 * Infers the mode from supplied credentials when `CREATIO_MCP_AUTH_MODE` is unset:
 * legacy (login/password) → client_credentials (id/secret) → delegated (stateless, no creds).
 */
function inferMode(): AuthMode {
	if (env('CREATIO_LOGIN') && env('CREATIO_PASSWORD')) {
		return 'legacy';
	}
	if (env('CREATIO_CLIENT_ID') && env('CREATIO_CLIENT_SECRET')) {
		return 'client_credentials';
	}
	return 'delegated';
}

function bearerConfig(mode: BearerAuthMode): BearerAuthConfig {
	const conf: BearerAuthConfig = { kind: AuthProviderType.OAuth2Bearer, mode };
	const idb = env('CREATIO_ID_BASE_URL');
	if (idb) {
		conf.idBaseUrl = idb;
	}
	return conf;
}

function clientCredentialsConfig(): OAuth2AuthConfig {
	const clientId = env('CREATIO_CLIENT_ID');
	const clientSecret = env('CREATIO_CLIENT_SECRET');
	if (!clientId || !clientSecret) {
		throw new Error(MISSING_CLIENT_CREDENTIALS);
	}
	const conf: OAuth2AuthConfig = { kind: AuthProviderType.OAuth2, clientId, clientSecret };
	const idb = env('CREATIO_ID_BASE_URL');
	if (idb) {
		conf.idBaseUrl = idb;
	}
	return conf;
}

/** HS256 security rests ENTIRELY on the secret's entropy, so a short secret is brute-forceable
 *  offline from any issued token. Refuse anything weaker than 32 chars (256 bits of base64). */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * The secret that signs the tokens the broker issues to its OWN clients. A stable secret is
 * required to (a) keep client tokens valid across restarts and (b) validate them across multiple
 * instances. A configured secret must clear the entropy floor; in production an explicit secret is
 * mandatory (fail closed). Outside production an unset secret yields an ephemeral one (with a
 * warning) so local/dev just works — at the cost of both properties above.
 */
function resolveBrokerJwtSecret(): string {
	const configured = env('CREATIO_MCP_JWT_SECRET');
	if (configured) {
		if (configured.length < MIN_JWT_SECRET_LENGTH) {
			throw new Error(
				`CREATIO_MCP_JWT_SECRET is too weak: it must be at least ${MIN_JWT_SECRET_LENGTH} ` +
					`characters (got ${configured.length}). HS256 token security depends entirely on it.`,
			);
		}
		return configured;
	}
	if (env('NODE_ENV') === 'production') {
		throw new Error(
			'CREATIO_MCP_JWT_SECRET is required in production for broker mode. Set a stable secret ' +
				`of at least ${MIN_JWT_SECRET_LENGTH} characters.`,
		);
	}
	log.warn('broker.jwt_secret.ephemeral', {
		detail:
			'CREATIO_MCP_JWT_SECRET is not set — generated a random one. Tokens issued to clients ' +
			'will be invalidated on restart and will not validate across multiple instances. Set a ' +
			'stable secret for production or horizontal scaling.',
	});
	return crypto.randomBytes(32).toString('base64url');
}

function brokerConfig(): BrokerAuthConfig {
	const clientId = env('CREATIO_CLIENT_ID');
	if (!clientId) {
		throw new Error(MISSING_BROKER);
	}
	const jwtSecret = resolveBrokerJwtSecret();
	const conf: BrokerAuthConfig = { kind: AuthProviderType.Broker, clientId, jwtSecret };
	const clientSecret = env('CREATIO_CLIENT_SECRET');
	if (clientSecret) {
		conf.clientSecret = clientSecret;
	}
	const idb = env('CREATIO_ID_BASE_URL');
	if (idb) {
		conf.idBaseUrl = idb;
	}
	return conf;
}

function legacyConfig(): LegacyAuthConfig {
	const login = env('CREATIO_LOGIN');
	const password = env('CREATIO_PASSWORD');
	if (!login || !password) {
		throw new Error(MISSING_LEGACY);
	}
	return { kind: AuthProviderType.Legacy, login, password };
}

/**
 * Resolves the one effective auth config from the unified `CREATIO_MCP_AUTH_MODE` selector
 * (explicit or inferred). Credential-based modes throw a clear error when their inputs are missing;
 * stateless Bearer modes (delegated/gateway) need none.
 */
function resolveAuthConfig(): CreatioClientAuthConfig {
	const mode = readExplicitMode() ?? inferMode();
	switch (mode) {
		case 'delegated':
			return bearerConfig(BearerAuthMode.Delegated);
		case 'gateway':
			return bearerConfig(BearerAuthMode.Gateway);
		case 'broker':
			return brokerConfig();
		case 'client_credentials':
			return clientCredentialsConfig();
		case 'legacy':
			return legacyConfig();
	}
}

function getCrudBackend(): CrudBackend {
	const raw = env('CREATIO_MCP_CRUD_BACKEND')?.toLowerCase();
	// DataService is the default backend (Creatio's native data API, what the UI uses);
	// set CREATIO_MCP_CRUD_BACKEND=odata to opt into the OData backend instead.
	if (!raw || raw === 'dataservice') {
		return 'dataservice';
	}
	if (raw !== 'odata') {
		throw new Error(`unsupported_crud_backend:${raw} (expected "odata" or "dataservice")`);
	}
	return 'odata';
}

function getRequiredBaseUrl(): string {
	const baseUrl = env('CREATIO_BASE_URL');
	if (!baseUrl) {
		throw new Error('Environment variable CREATIO_BASE_URL is required but not set');
	}
	return baseUrl;
}

export function getCreatioClientConfig(): CreatioClientConfig {
	return {
		baseUrl: getRequiredBaseUrl(),
		auth: resolveAuthConfig(),
		crudBackend: getCrudBackend(),
	};
}
