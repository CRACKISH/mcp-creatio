import log from '../log';
import { env } from '../utils';

/**
 * Opt-in proactive session keep-alive for the SINGLE-SESSION auth modes (`legacy` / `client_credentials`).
 *
 * A Creatio forms (cookie) session is auto-logged-out after an idle period, so a long-idle MCP pays a
 * re-login round-trip on the next call. Reactive reconnect (the HTTP client's 401 / login-bounce
 * retry) already keeps things CORRECT; this only removes that first-call latency by issuing a cheap
 * authenticated "pseudo-activity" request on an interval to reset the server-side idle timer.
 *
 * Deliberately NOT used for `broker`/`delegated`/`gateway`: those are per-user / per-request and have
 * no single shared session to keep warm (broker refreshes per-user on demand instead).
 */
export class SessionKeepAlive {
	private _timer: NodeJS.Timeout | undefined;

	constructor(
		private readonly _intervalMs: number,
		private readonly _ping: () => Promise<unknown>,
	) {}

	public start(): void {
		if (this._intervalMs <= 0 || this._timer) {
			return;
		}
		this._timer = setInterval(() => {
			void this._ping().catch((err) =>
				log.warn('keepalive.ping.failed', { error: String(err) }),
			);
		}, this._intervalMs);
		// Never hold the event loop open just for the keep-alive.
		this._timer.unref();
		log.info('keepalive.start', { intervalMs: this._intervalMs });
	}

	public stop(): void {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = undefined;
		}
	}
}

/**
 * Keep-alive interval in ms from `CREATIO_MCP_KEEPALIVE_SECONDS` (0 / unset = disabled). Keep it
 * comfortably below the Creatio session idle timeout (commonly 20–30 min).
 */
export function keepAliveIntervalMs(): number {
	const raw = Number(env('CREATIO_MCP_KEEPALIVE_SECONDS'));
	return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) * 1000 : 0;
}
