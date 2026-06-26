export interface RateLimitOptions {
	/** Length of the fixed window in milliseconds. */
	windowMs: number;
	/** Maximum number of requests allowed per key within the window. */
	max: number;
}

export interface RateLimitResult {
	allowed: boolean;
	retryAfterMs: number;
}

interface Bucket {
	count: number;
	resetAt: number;
}

/**
 * Minimal fixed-window in-memory rate limiter. Keyed by an arbitrary string
 * (typically the client IP). Bounded memory: expired buckets are swept lazily
 * once per window, so there is no background timer to leak.
 */
export class RateLimiter {
	private readonly _buckets = new Map<string, Bucket>();
	private readonly _options: RateLimitOptions;
	private _lastSweepAt = 0;

	constructor(options: RateLimitOptions) {
		this._options = options;
	}

	public check(key: string, now: number): RateLimitResult {
		this._maybeSweep(now);
		const bucket = this._buckets.get(key);
		if (!bucket || now >= bucket.resetAt) {
			this._buckets.set(key, { count: 1, resetAt: now + this._options.windowMs });
			return { allowed: true, retryAfterMs: 0 };
		}
		if (bucket.count >= this._options.max) {
			return { allowed: false, retryAfterMs: bucket.resetAt - now };
		}
		bucket.count++;
		return { allowed: true, retryAfterMs: 0 };
	}

	private _maybeSweep(now: number): void {
		if (now - this._lastSweepAt < this._options.windowMs) {
			return;
		}
		this._lastSweepAt = now;
		for (const [key, bucket] of this._buckets.entries()) {
			if (now >= bucket.resetAt) {
				this._buckets.delete(key);
			}
		}
	}
}
