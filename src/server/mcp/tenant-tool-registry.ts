import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ToolHandler } from './tool-preparer';

/**
 * Tenant bucket for every single-tenant auth mode (legacy / client-credentials / delegated /
 * broker) and any gateway request that does NOT override the base URL. In those modes there is
 * exactly one Creatio instance, so one shared bucket is correct and the behaviour is identical to
 * the pre-multitenant server. Only a gateway request carrying `X-Creatio-Base-Url` gets its own
 * per-instance bucket — that is where cross-tenant isolation actually matters.
 */
export const DEFAULT_TENANT_KEY = '__default__';

/** A capability tool discovered for one tenant: its MCP descriptor + the handler that runs it. */
export interface DynamicTool {
	descriptor: unknown;
	handler: ToolHandler;
}

/**
 * Per-tenant capability + dynamic-tool state — one entry per effective Creatio base URL. Each
 * tenant carries its OWN optional-capability probe verdicts, the tools those capabilities
 * registered, and the live session servers to push late-discovered tools into. Keeping all of this
 * per-tenant is what stops tenant A's capability verdict (DataForge on/off) or A's published tools
 * from leaking to tenant B on a shared multi-tenant (gateway) deployment — the previous design
 * probed once from the first caller and applied that verdict to everyone.
 */
export class TenantToolState {
	public readonly capabilities = new Map<string, boolean>();
	public readonly cooldownUntil = new Map<string, number>();
	public readonly dynamicTools = new Map<string, DynamicTool>();
	public readonly sessionServers = new Set<McpServer>();
	public probeComplete = false;
	public probeInFlight = false;
	public lastAccessMs: number;

	constructor(now: number) {
		this.lastAccessMs = now;
	}
}

export interface TenantToolRegistryOptions {
	/** Max distinct tenants retained; idle, session-less tenants are evicted LRU past this. */
	maxTenants?: number;
	/** Idle TTL (ms): a tenant with NO live sessions is dropped after this long untouched. */
	ttlMs?: number;
}

/**
 * Holds {@link TenantToolState} per tenant with TTL + LRU eviction — the tool-surface analog of a
 * tenant client pool. A tenant with live session servers is NEVER evicted (its dynamic tools back
 * those live sessions); only idle, session-less tenants are pruned, so memory stays bounded as the
 * number of distinct Creatio instances seen by a gateway deployment grows.
 */
export class TenantToolRegistry {
	private readonly _maxTenants: number;
	private readonly _ttlMs: number;
	private readonly _tenants = new Map<string, TenantToolState>();

	public get size(): number {
		return this._tenants.size;
	}

	constructor(options: TenantToolRegistryOptions = {}) {
		this._maxTenants = options.maxTenants ?? 100;
		this._ttlMs = options.ttlMs ?? 30 * 60_000;
	}

	/** Evict idle, session-less tenants past the TTL, then enforce the LRU cap (still only over
	 *  session-less tenants — an active tenant whose dynamic tools back a live session is kept). */
	private _prune(now: number): void {
		for (const [key, state] of this._tenants) {
			if (state.sessionServers.size === 0 && now - state.lastAccessMs > this._ttlMs) {
				this._tenants.delete(key);
			}
		}
		if (this._tenants.size <= this._maxTenants) {
			return;
		}
		const evictable = Array.from(this._tenants.entries())
			.filter(([, state]) => state.sessionServers.size === 0)
			.sort((a, b) => a[1].lastAccessMs - b[1].lastAccessMs);
		let over = this._tenants.size - this._maxTenants;
		for (const [key] of evictable) {
			if (over <= 0) {
				break;
			}
			this._tenants.delete(key);
			over--;
		}
	}

	/** The state for a tenant, creating it on first use. Touches recency, then prunes stale peers —
	 *  pruning AFTER the insert/touch so the cap is enforced on the resulting set (never left over
	 *  by one) and the just-accessed tenant is the most-recently-used, so never the one evicted. */
	public getState(tenantKey: string, now: number = Date.now()): TenantToolState {
		const existing = this._tenants.get(tenantKey);
		if (existing) {
			existing.lastAccessMs = now;
			this._prune(now);
			return existing;
		}
		const state = new TenantToolState(now);
		this._tenants.set(tenantKey, state);
		this._prune(now);
		return state;
	}

	/** The tenant state owning a given session server (to release it when its transport closes). */
	public findBySession(mcp: McpServer): TenantToolState | undefined {
		for (const state of this._tenants.values()) {
			if (state.sessionServers.has(mcp)) {
				return state;
			}
		}
		return undefined;
	}

	/** Every live session server across all tenants (process shutdown). */
	public allSessionServers(): McpServer[] {
		const servers: McpServer[] = [];
		for (const state of this._tenants.values()) {
			for (const mcp of state.sessionServers) {
				servers.push(mcp);
			}
		}
		return servers;
	}

	/** Drop all tenant state (process shutdown). */
	public clear(): void {
		this._tenants.clear();
	}
}
