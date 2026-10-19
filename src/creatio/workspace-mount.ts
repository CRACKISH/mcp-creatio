import log from '../log';

import { VersionedTtlCache } from './services/versioned-ttl-cache';

/**
 * Where a Creatio instance mounts its workspace app: `/0` on .NET Framework, the site root on
 * .NET 8. It matters for the routes that exist ONLY at the real mount — OData, `api/*`,
 * `connect/*`, `.well-known/*` (verified live: on .NET 8 `/0/odata` and `/0/connect/token` 404,
 * on .NET Framework the root forms 404). `/0/rest`, `/0/DataService` and `/0/ServiceModel` answer
 * on both runtimes, so callers of those keep their fixed `/0` prefix.
 */
export type WorkspaceMount = '/0' | '';

export interface WorkspaceMountResolver {
	resolve(baseUrl: string): Promise<WorkspaceMount>;
}

/** The pre-detection behaviour (always `/0`): the default until {@link installWorkspaceMountDetection}. */
const LEGACY_MOUNT: WorkspaceMountResolver = { resolve: async () => '/0' };

// A route every Creatio version serves anonymously at the mount: `/0/...` 404s only when the app
// is mounted at the root (.NET 8). GET is side-effect free there (302 / 405 on .NET Framework).
const PROBE_PATH = '/0/ServiceModel/AuthService.svc/Login';
const PROBE_TIMEOUT_MS = 10_000;
// A runtime does not change under a running process; the TTL only bounds staleness after a
// redeploy, and the cap bounds memory on a multi-tenant gateway.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TENANTS = 100;
const CACHE_VERSION = 'v1';

/**
 * Detects the mount once per base URL with one anonymous request, caching the verdict (bounded,
 * single-flight). A failed probe (network, timeout, or an inconclusive status such as 5xx/403/429)
 * is NOT cached and falls back to `/0` for that call, so a transient blip self-heals on the next
 * request instead of pinning a wrong answer.
 */
export class ProbingWorkspaceMountResolver implements WorkspaceMountResolver {
	private readonly _cache = new VersionedTtlCache<WorkspaceMount>(CACHE_TTL_MS, MAX_TENANTS);

	/** A definitive verdict only: 404 → root mount (.NET 8); 2xx/3xx/405 → `/0`; else `undefined`. */
	private static _mountFromStatus(status: number): WorkspaceMount | undefined {
		if (status === 404) {
			return '';
		}
		if ((status >= 200 && status < 400) || status === 405) {
			return '/0';
		}
		return undefined;
	}

	private async _probe(baseUrl: string): Promise<WorkspaceMount> {
		const response = await fetch(baseUrl + PROBE_PATH, {
			redirect: 'manual',
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		const { status } = response;
		// Only the status matters; release the socket instead of leaving the body for GC.
		await response.body?.cancel().catch(() => undefined);
		const mount = ProbingWorkspaceMountResolver._mountFromStatus(status);
		if (mount === undefined) {
			// 5xx (app pool restarting), 401/403 (WAF), 429 … say nothing about the mount: throw so
			// `resolve` falls back to `/0` for this call only, instead of caching a guess for the TTL.
			throw new Error(`inconclusive workspace-mount probe status ${status}`);
		}
		log.info('creatio.workspace_mount.detected', { baseUrl, mount: mount || '/' });
		return mount;
	}

	public async resolve(baseUrl: string): Promise<WorkspaceMount> {
		try {
			return await this._cache.getOrLoad(baseUrl, CACHE_VERSION, () => this._probe(baseUrl));
		} catch (err) {
			log.warn('creatio.workspace_mount.probe_failed', { baseUrl, error: String(err) });
			return '/0';
		}
	}
}

let _resolver: WorkspaceMountResolver = LEGACY_MOUNT;

/** Turn on runtime detection for this process (entry points only, like `installHttpAgent`). */
export function installWorkspaceMountDetection(
	resolver: WorkspaceMountResolver = new ProbingWorkspaceMountResolver(),
): void {
	_resolver = resolver;
}

/** Restore the legacy fixed `/0` mount (tests). */
export function resetWorkspaceMountDetection(): void {
	_resolver = LEGACY_MOUNT;
}

/** The instance base plus its workspace mount, e.g. `https://x/0` (.NET Framework) or `https://x`. */
export async function workspaceBaseUrl(baseUrl: string): Promise<string> {
	const base = baseUrl.replace(/\/$/, '');
	return base + (await _resolver.resolve(base));
}
