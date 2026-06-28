import { Agent, setGlobalDispatcher } from 'undici';

import log from '../log';

let _installed = false;

/**
 * Tune the global undici dispatcher behind Node's `fetch` — every outbound Creatio call goes through
 * it. Node's default keep-alive timeout is short, so bursty MCP tool calls to a remote Creatio keep
 * paying a fresh TLS+TCP handshake; a longer keep-alive plus a real per-origin connection pool reuses
 * warm sockets and roughly halves cold-call latency. Idempotent and best-effort: any failure just
 * leaves Node's default dispatcher in place (correctness is unaffected, only latency).
 */
export function installHttpAgent(): void {
	if (_installed) {
		return;
	}
	_installed = true;
	try {
		setGlobalDispatcher(
			new Agent({
				keepAliveTimeout: 30_000, // keep idle sockets ~30s across gaps between tool calls
				keepAliveMaxTimeout: 600_000,
				connections: 64, // per-origin pool (fine for one Creatio or per-tenant in gateway mode)
				pipelining: 1,
			}),
		);
		log.info('http.dispatcher.tuned', { keepAliveTimeoutMs: 30_000, connections: 64 });
	} catch (err) {
		log.warn('http.dispatcher.tune_failed', { error: String(err) });
	}
}
