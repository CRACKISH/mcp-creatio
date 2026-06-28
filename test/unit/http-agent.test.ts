import { describe, expect, it } from 'vitest';

import { installHttpAgent } from '../../src/server/http-agent';

describe('installHttpAgent', () => {
	it('does not throw and is idempotent', () => {
		expect(() => installHttpAgent()).not.toThrow();
		// Second call short-circuits on the _installed guard.
		expect(() => installHttpAgent()).not.toThrow();
	});
});
