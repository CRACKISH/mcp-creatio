import { describe, expect, it } from 'vitest';

import {
	DEFAULT_TENANT_KEY,
	TenantToolRegistry,
	TenantToolState,
} from '../../src/server/mcp/tenant-tool-registry';

// A throwaway stand-in for an McpServer — the registry only ever holds the reference in a Set and
// compares by identity, so any unique object suffices.
function fakeMcp(): any {
	return {};
}

describe('TenantToolState', () => {
	it('starts empty with the supplied access time', () => {
		const state = new TenantToolState(1000);
		expect(state.lastAccessMs).toBe(1000);
		expect(state.probeComplete).toBe(false);
		expect(state.probeInFlight).toBe(false);
		expect(state.capabilities.size).toBe(0);
		expect(state.cooldownUntil.size).toBe(0);
		expect(state.dynamicTools.size).toBe(0);
		expect(state.sessionServers.size).toBe(0);
	});
});

describe('TenantToolRegistry', () => {
	it('creates a state on first use and reuses it on the next call', () => {
		const registry = new TenantToolRegistry();
		const a = registry.getState('https://a', 1000);
		const again = registry.getState('https://a', 2000);
		expect(again).toBe(a);
		expect(registry.size).toBe(1);
	});

	it('touches lastAccess on reuse', () => {
		const registry = new TenantToolRegistry();
		const a = registry.getState('https://a', 1000);
		registry.getState('https://a', 5000);
		expect(a.lastAccessMs).toBe(5000);
	});

	it('keeps distinct tenants separate (no cross-tenant bleed)', () => {
		const registry = new TenantToolRegistry();
		const a = registry.getState('https://a', 1000);
		const b = registry.getState('https://b', 1000);
		expect(a).not.toBe(b);
		a.capabilities.set('dataforge', true);
		expect(b.capabilities.has('dataforge')).toBe(false);
		expect(registry.size).toBe(2);
	});

	it('prunes idle, session-less tenants past the TTL', () => {
		const registry = new TenantToolRegistry({ ttlMs: 1000 });
		registry.getState('https://idle', 0);
		// A later access for a different tenant triggers the prune; the idle one is now stale.
		registry.getState('https://fresh', 5000);
		expect(registry.size).toBe(1);
		expect(registry.findBySession(fakeMcp())).toBeUndefined();
	});

	it('never prunes a tenant that still has a live session, even when stale', () => {
		const registry = new TenantToolRegistry({ ttlMs: 1000 });
		const busy = registry.getState('https://busy', 0);
		busy.sessionServers.add(fakeMcp());
		registry.getState('https://fresh', 100000); // way past TTL — prune runs
		expect(registry.size).toBe(2); // busy survived because it has a live session
	});

	it('enforces the LRU cap, evicting only session-less tenants', () => {
		const registry = new TenantToolRegistry({ maxTenants: 2, ttlMs: Number.MAX_SAFE_INTEGER });
		const pinned = registry.getState('https://pinned', 1); // oldest, but will hold a session
		pinned.sessionServers.add(fakeMcp());
		registry.getState('https://mid', 2);
		registry.getState('https://new', 3); // now 3 > cap 2 → evict LRU among session-less
		// 'mid' (oldest session-less) is evicted; 'pinned' survives despite being the oldest overall.
		expect(registry.size).toBe(2);
		expect(registry.findBySession([...pinned.sessionServers][0])).toBe(pinned);
	});

	it('finds the tenant that owns a session server', () => {
		const registry = new TenantToolRegistry();
		const a = registry.getState('https://a', 1);
		const mcp = fakeMcp();
		a.sessionServers.add(mcp);
		expect(registry.findBySession(mcp)).toBe(a);
		expect(registry.findBySession(fakeMcp())).toBeUndefined();
	});

	it('lists every live session server across tenants and clears them', () => {
		const registry = new TenantToolRegistry();
		const a = registry.getState('https://a', 1);
		const b = registry.getState('https://b', 1);
		const m1 = fakeMcp();
		const m2 = fakeMcp();
		a.sessionServers.add(m1);
		b.sessionServers.add(m2);
		expect(registry.allSessionServers()).toEqual(expect.arrayContaining([m1, m2]));
		expect(registry.allSessionServers()).toHaveLength(2);
		registry.clear();
		expect(registry.size).toBe(0);
		expect(registry.allSessionServers()).toHaveLength(0);
	});

	it('exposes a stable default-tenant key for single-tenant modes', () => {
		expect(DEFAULT_TENANT_KEY).toBe('__default__');
	});
});
