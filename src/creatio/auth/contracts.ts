import { AuthProviderType } from './providers';

/**
 * The single capability every auth provider has: attach auth headers, refresh on 401, and a safe
 * cancel hook for background timers. Deliberately small (ISP) — the stateless Bearer, client-
 * credentials and legacy providers all fit this one shape; there is no longer any token-issuing or
 * interactive-flow surface on the MCP (clients authenticate against Creatio Identity directly).
 */
export interface ICreatioAuthProvider {
	type: AuthProviderType;
	getHeaders(accept: string, isJson?: boolean): Promise<Record<string, string>>;
	refresh(): Promise<void>;
	/** Cancels any background timers. Safe no-op for providers without them. */
	cancelAllRefresh(): void;
}
