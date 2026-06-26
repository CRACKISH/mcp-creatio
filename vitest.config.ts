import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		// Keep the OAuth/session logger quiet during tests.
		env: { MCP_CREATIO_LOG_LEVEL: 'silent' },
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/index.ts', 'src/types/**', 'src/**/*-data.ts'],
		},
	},
});
