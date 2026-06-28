export enum AuthProviderType {
	Legacy = 'legacy',
	OAuth2 = 'oauth2',
	/**
	 * Stateless per-request Bearer passthrough: the incoming request carries a Creatio access token
	 * (obtained by the client directly from Creatio Identity in `delegated` mode, or injected by a
	 * fronting Control-Plane in `gateway` mode). The MCP issues no tokens and stores none.
	 */
	OAuth2Bearer = 'oauth2_bearer',
	/**
	 * Broker: the MCP is its own OAuth 2.1 authorization server for clients (DCR + /authorize +
	 * /token), brokering the user login to Creatio via authorization_code + PKCE and holding the
	 * user's Creatio tokens server-side. The "connect → authorize → work as me" UX for standalone
	 * direct clients (Claude Desktop / ChatGPT) where Creatio offers no dynamic client registration.
	 */
	Broker = 'broker',
}

/** Where the per-request Bearer comes from / how strictly the MCP treats it. */
export enum BearerAuthMode {
	/** Client authenticates directly against Creatio Identity; MCP advertises it (RFC 9728) + validates. */
	Delegated = 'delegated',
	/** A trusted fronting gateway (Creatio.ai Control-Plane) injects the Bearer; MCP trusts it. */
	Gateway = 'gateway',
}
