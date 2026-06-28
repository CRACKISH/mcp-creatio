import { describe, expect, it, vi } from 'vitest';

import { CreatioEngineManager } from '../../src/creatio';
import { makeFakeContext } from '../support/fake-context';

describe('CreatioEngineManager.warmSchemaCache', () => {
	it('delegates to the context when it supports warming (keep-alive reuse)', async () => {
		const context = makeFakeContext() as ReturnType<typeof makeFakeContext> & {
			warmSchemaCache: ReturnType<typeof vi.fn>;
		};
		context.warmSchemaCache = vi.fn().mockResolvedValue(undefined);
		const engines = new CreatioEngineManager(context as never);
		await engines.warmSchemaCache();
		expect(context.warmSchemaCache).toHaveBeenCalledTimes(1);
	});

	it('is a safe no-op when the context does not support warming (test fakes)', async () => {
		const engines = new CreatioEngineManager(makeFakeContext() as never);
		await expect(engines.warmSchemaCache()).resolves.toBeUndefined();
	});
});
