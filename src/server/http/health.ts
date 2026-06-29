import { NAME, VERSION } from '../../version';

import type { Express, Request, Response } from 'express';

export const LIVENESS_PATH = '/healthz';
export const READINESS_PATH = '/readyz';

/**
 * Liveness + readiness endpoints for orchestrators (Kubernetes probes, load balancers).
 *
 * Registered BEFORE the auth and request-logging middleware so probes are unauthenticated and do
 * not flood the logs at the probe interval. Liveness reports only that the process is up; readiness
 * gates on a flag the app flips on once the HTTP listener accepts traffic and back off at the start
 * of graceful shutdown — so the orchestrator drains this pod before SIGTERM tears connections down.
 */
export class HealthEndpoints {
	private _ready = false;
	private readonly _startedAt = Date.now();

	/** On once the server is listening; off again when shutdown begins (stop routing new traffic). */
	public setReady(ready: boolean): void {
		this._ready = ready;
	}

	public register(app: Express): void {
		app.get(LIVENESS_PATH, (_req: Request, res: Response) => {
			res.status(200).json({
				status: 'ok',
				name: NAME,
				version: VERSION,
				uptimeSec: Math.floor((Date.now() - this._startedAt) / 1000),
			});
		});
		app.get(READINESS_PATH, (_req: Request, res: Response) => {
			if (this._ready) {
				res.status(200).json({ status: 'ready' });
				return;
			}
			res.status(503).json({ status: 'starting' });
		});
	}
}
